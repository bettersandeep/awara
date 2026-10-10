// SRD 3.5 resolution. Every function rolls real dice and returns a readable log line.
import { type Rng, rollD20, roll, rollDiceExpression } from "./dice.ts";
import {
  type Ability, type Character, type Save,
  WEAPONS, abilityModifier, armorClass, attackBonus, lifeState, saveBonus,
} from "./character.ts";

export type CheckResult = { success: boolean; roll: number; total: number; log: string };

// "d20(17)-2=15", never "d20(17)+-2=15"
const describeRoll = (d20: number, bonus: number) => `d20(${d20})${bonus < 0 ? "-" : "+"}${Math.abs(bonus)}=${d20 + bonus}`;

export function skillCheck(rng: Rng, c: Character, skill: string, ability: Ability, dc: number): CheckResult {
  const d20 = rollD20(rng);
  const bonus = (c.skillRanks[skill] ?? 0) + abilityModifier(c.abilities[ability]);
  const total = d20 + bonus;
  return { success: total >= dc, roll: d20, total, log: `${c.name} ${skill}: ${describeRoll(d20, bonus)} vs DC ${dc}` };
}

export function savingThrow(rng: Rng, c: Character, save: Save, dc: number): CheckResult {
  const d20 = rollD20(rng);
  const bonus = saveBonus(c, save);
  const total = d20 + bonus;
  return { success: total >= dc, roll: d20, total, log: `${c.name} ${save} save: ${describeRoll(d20, bonus)} vs DC ${dc}` };
}

export function rollInitiative(rng: Rng, combatants: Character[]): { order: string[]; log: string } {
  const rolls = combatants.map((c) => ({
    id: c.id,
    name: c.name,
    initiative: rollD20(rng) + abilityModifier(c.abilities.dex),
    dex: c.abilities.dex,
  }));
  // SRD tie-break: higher dexterity acts first
  rolls.sort((a, b) => b.initiative - a.initiative || b.dex - a.dex);
  return { order: rolls.map((r) => r.id), log: rolls.map((r) => `${r.name} ${r.initiative}`).join(", ") };
}

export type AttackResult = { hit: boolean; crit: boolean; damage: number; log: string };

export function attack(rng: Rng, attacker: Character, target: Character): AttackResult {
  const weapon = WEAPONS[attacker.weapon];
  const targetAc = armorClass(target);
  const bonus = attackBonus(attacker);
  const d20 = rollD20(rng);
  // natural 1 always misses, natural 20 always hits
  const hit = d20 !== 1 && (d20 === 20 || d20 + bonus >= targetAc);
  let log = `${attacker.name} attacks ${target.name} with ${weapon.name}: ${describeRoll(d20, bonus)} vs AC ${targetAc}`;
  if (!hit) return { hit, crit: false, damage: 0, log: `${log} - miss` };

  let crit = false;
  if (d20 >= weapon.critRangeStart) {
    const confirmRoll = rollD20(rng);
    crit = confirmRoll !== 1 && (confirmRoll === 20 || confirmRoll + bonus >= targetAc);
    log += ` threat, confirm ${describeRoll(confirmRoll, bonus)}${crit ? " CRIT" : " no crit"}`;
  }
  const damageModifier = weapon.ranged ? 0 : abilityModifier(attacker.abilities.str);
  // SRD: a crit rolls the weapon damage critMultiplier times
  const damageRolls = crit ? weapon.critMultiplier : 1;
  let damage = 0;
  for (let i = 0; i < damageRolls; i++) damage += rollDiceExpression(rng, weapon.damage) + damageModifier;
  damage = Math.max(1, damage);
  applyDamage(target, damage);
  return { hit, crit, damage, log: `${log} - hit for ${damage} (${target.name} ${target.hp}hp, ${lifeState(target)})` };
}

export function applyDamage(c: Character, amount: number) {
  c.hp -= amount;
}

export function heal(c: Character, amount: number) {
  c.hp = Math.min(c.maxHp, c.hp + amount);
}

export const SPELLS = ["magic missile", "cure light wounds"] as const;
export type Spell = (typeof SPELLS)[number];

export type SpellResult = { success: boolean; amount: number; log: string };

export function castSpell(rng: Rng, caster: Character, spell: Spell, target: Character): SpellResult {
  if (caster.spellSlots < 1) return { success: false, amount: 0, log: `${caster.name} has no spell slots left` };
  caster.spellSlots -= 1;

  if (spell === "magic missile") {
    const missiles = Math.min(5, 1 + Math.floor((caster.level - 1) / 2));
    let damage = 0;
    for (let i = 0; i < missiles; i++) damage += roll(rng, 1, 4)[0] + 1;
    applyDamage(target, damage);
    return {
      success: true, amount: damage,
      log: `${caster.name} casts magic missile: ${missiles} missile(s), ${damage} damage (${target.name} ${target.hp}hp, ${lifeState(target)})`,
    };
  }

  const hpBefore = target.hp;
  heal(target, roll(rng, 1, 8)[0] + Math.min(5, caster.level));
  const healed = target.hp - hpBefore;
  return { success: true, amount: healed, log: `${caster.name} casts cure light wounds: heals ${healed} (${target.name} ${target.hp}hp)` };
}
