import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, roll, rollDiceExpression } from "../src/rules/dice.ts";
import {
  type CharacterSpec, abilityModifier, armorClass, attackBonus, lifeState, makeCharacter, saveBonus,
} from "../src/rules/character.ts";
import { applyDamage, attack, castSpell, heal, rollInitiative, savingThrow, skillCheck } from "../src/rules/engine.ts";

const makeTestCharacter = (spec: Partial<CharacterSpec> & Pick<CharacterSpec, "characterClass">, seed = 1) =>
  makeCharacter(makeRng(seed), {
    id: spec.characterClass, name: spec.characterClass,
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    armor: "none", shield: false, weapon: "longsword", sprite: "fighter",
    ...spec,
  });

const fighter = (id = "thorin") =>
  makeTestCharacter({ id, characterClass: "fighter", armor: "chainmail", shield: true });

const wizard = () =>
  makeTestCharacter({
    id: "mira", characterClass: "wizard", weapon: "quarterstaff",
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
  });

test("dice are deterministic for a seed", () => {
  assert.deepEqual(roll(makeRng(42), 5, 20), roll(makeRng(42), 5, 20));
});

test("dice stay in bounds and parse expressions", () => {
  const rng = makeRng(7);
  for (let i = 0; i < 1000; i++) {
    const [value] = roll(rng, 1, 20);
    assert.ok(value >= 1 && value <= 20);
  }
  for (let i = 0; i < 100; i++) {
    const total = rollDiceExpression(rng, "2d6+3");
    assert.ok(total >= 5 && total <= 15);
  }
  assert.throws(() => rollDiceExpression(rng, "d20"));
});

test("fighter and wizard derived stats follow the SRD", () => {
  const f = fighter();
  assert.equal(abilityModifier(16), 3);
  assert.equal(f.maxHp, 12); // d10 + con 2
  assert.equal(armorClass(f), 19); // 10 + chainmail 5 + shield 2 + dex 2 (max 2)
  assert.equal(attackBonus(f), 4); // bab 1 + str 3
  assert.equal(saveBonus(f, "fort"), 4); // good 2 + con 2
  assert.equal(saveBonus(f, "will"), 1); // poor 0 + wis 1
  const w = wizard();
  assert.equal(w.maxHp, 5); // d4 + con 1
  assert.equal(w.spellSlots, 2); // 1 + int bonus
});

test("other SRD classes: barbarian, monk, sorcerer", () => {
  const barbarian = makeTestCharacter({
    characterClass: "barbarian", weapon: "greataxe", armor: "leather",
    abilities: { str: 17, dex: 13, con: 16, int: 8, wis: 10, cha: 8 },
  });
  assert.equal(barbarian.maxHp, 15); // d12 + con 3
  assert.equal(attackBonus(barbarian), 4); // full bab 1 + str 3
  assert.equal(saveBonus(barbarian, "fort"), 5);

  const monk = makeTestCharacter({
    characterClass: "monk", weapon: "unarmed",
    abilities: { str: 13, dex: 15, con: 12, int: 10, wis: 15, cha: 8 },
  });
  assert.equal(armorClass(monk), 14); // 10 + dex 2 + wis 2
  assert.equal(saveBonus(monk, "will"), 4); // all saves are good

  const sorcerer = makeTestCharacter({
    characterClass: "sorcerer", weapon: "dagger",
    abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 16 },
  });
  assert.equal(sorcerer.spellSlots, 2); // charisma caster bonus
});

test("attacks hit at a plausible rate and damage stays in bounds", () => {
  let hits = 0;
  const attempts = 300;
  for (let seed = 0; seed < attempts; seed++) {
    const attacker = fighter();
    const target = fighter("goblin");
    const result = attack(makeRng(seed), attacker, target);
    if (result.hit) {
      hits++;
      assert.ok(result.damage >= 1);
      assert.ok(result.damage <= (result.crit ? 22 : 11)); // (1d8+3) x2 at most
      assert.equal(target.hp, target.maxHp - result.damage);
    } else {
      assert.equal(result.damage, 0);
      assert.equal(target.hp, target.maxHp);
    }
  }
  // +4 against AC 19 needs 15 or more, about 30% of rolls
  assert.ok(hits > attempts * 0.15 && hits < attempts * 0.5, `hit rate ${hits}/${attempts}`);
});

test("roll logs show a negative bonus as a minus sign", () => {
  const weakling = makeTestCharacter({ id: "rat", characterClass: "rogue", weapon: "claw", abilities: { str: 4, dex: 15, con: 10, int: 2, wis: 12, cha: 4 } });
  const { log } = attack(makeRng(1), weakling, fighter());
  assert.match(log, /d20\(\d+\)-3=/);
  assert.doesNotMatch(log, /\+-/);
});

test("skill checks and saves add the right bonuses", () => {
  const rng = makeRng(3);
  const f = fighter();
  f.skillRanks.climb = 4;
  const check = skillCheck(rng, f, "climb", "str", 10);
  assert.equal(check.total, check.roll + 7);
  const save = savingThrow(rng, f, "ref", 15);
  assert.equal(save.total, save.roll + 2); // poor 0 + dex 2
});

test("initiative orders every combatant", () => {
  const { order } = rollInitiative(makeRng(9), [fighter("a"), fighter("b"), wizard()]);
  assert.deepEqual([...order].sort(), ["a", "b", "mira"]);
});

test("life states follow hit points", () => {
  const f = fighter();
  applyDamage(f, f.maxHp);
  assert.equal(lifeState(f), "disabled");
  applyDamage(f, 3);
  assert.equal(lifeState(f), "dying");
  applyDamage(f, 7);
  assert.equal(lifeState(f), "dead");
});

test("spells use slots, deal damage and cap healing", () => {
  const rng = makeRng(5);
  const w = wizard();
  const f = fighter();
  const missile = castSpell(rng, w, "magic missile", f);
  assert.ok(missile.success && missile.amount >= 2 && missile.amount <= 5); // 1 missile, 1d4+1
  assert.equal(w.spellSlots, 1);
  applyDamage(f, 5);
  const hurtHp = f.hp;
  const cure = castSpell(rng, w, "cure light wounds", f);
  assert.ok(cure.success && f.hp > hurtHp && f.hp <= f.maxHp);
  assert.equal(castSpell(rng, w, "magic missile", f).success, false);
  const healthy = fighter("healthy");
  heal(healthy, 100);
  assert.equal(healthy.hp, healthy.maxHp);
});
