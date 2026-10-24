// SRD 3.5 resolution. Every function rolls real dice and returns a readable log line.
import { type Rng, rollD20, roll, rollDiceExpression } from "./dice.ts";
import {
  type Ability, type Character, type Save, type Skill, type Spell,
  SKILLS, WEAPONS, abilityModifier, armorClass, attackBonus, canAct, canCast, lifeState, saveBonus, spellSlotsPerDay,
} from "./character.ts";

export type CheckResult = { success: boolean; roll: number; total: number; log: string };

// "d20(17)-2=15", never "d20(17)+-2=15"
const describeRoll = (d20: number, bonus: number) => `d20(${d20})${bonus < 0 ? "-" : "+"}${Math.abs(bonus)}=${d20 + bonus}`;

function check(rng: Rng, c: Character, label: string, bonus: number, dc: number): CheckResult {
  const d20 = rollD20(rng);
  const total = d20 + bonus;
  return { success: total >= dc, roll: d20, total, log: `${c.name} ${label}: ${describeRoll(d20, bonus)} vs DC ${dc}` };
}

// A skill check uses the skill's key ability unless `ability` overrides it.
// With no skill, it is a plain ability check (for example strength to break a door).
export function skillCheck(rng: Rng, c: Character, skill: Skill | undefined, ability: Ability | undefined, dc: number): CheckResult {
  const keyAbility = ability ?? (skill && SKILLS[skill]);
  if (!keyAbility) throw new Error("give a skill, an ability, or both");
  const bonus = (skill ? c.skillRanks[skill] ?? 0 : 0) + abilityModifier(c.abilities[keyAbility]);
  return check(rng, c, skill ?? `${keyAbility} check`, bonus, dc);
}

export const savingThrow = (rng: Rng, c: Character, save: Save, dc: number): CheckResult =>
  check(rng, c, `${save} save`, saveBonus(c, save), dc);

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

// SRD: a natural 1 always misses and a natural 20 always hits.
const beatsArmorClass = (d20: number, bonus: number, targetAc: number) => d20 !== 1 && (d20 === 20 || d20 + bonus >= targetAc);

function damageModifier(attacker: Character): number {
  const weapon = WEAPONS[attacker.weapon];
  if (weapon.ranged) return 0;
  const strength = abilityModifier(attacker.abilities.str);
  return weapon.twoHanded && strength > 0 ? Math.floor(strength * 1.5) : strength;
}

export function attack(rng: Rng, attacker: Character, target: Character): AttackResult {
  if (!canAct(attacker)) return { hit: false, crit: false, damage: 0, log: `${attacker.name} is ${lifeState(attacker)} and cannot attack` };
  const weapon = WEAPONS[attacker.weapon];
  const targetAc = armorClass(target);
  const bonus = attackBonus(attacker);
  const d20 = rollD20(rng);
  const hit = beatsArmorClass(d20, bonus, targetAc);
  let log = `${attacker.name} attacks ${target.name} with ${weapon.name}: ${describeRoll(d20, bonus)} vs AC ${targetAc}`;
  if (!hit) return { hit, crit: false, damage: 0, log: `${log} - miss` };

  let crit = false;
  if (d20 >= weapon.critRangeStart) {
    const confirmRoll = rollD20(rng);
    crit = beatsArmorClass(confirmRoll, bonus, targetAc);
    log += ` threat, confirm ${describeRoll(confirmRoll, bonus)}${crit ? " CRIT" : " no crit"}`;
  }
  // SRD: a crit rolls the weapon damage critMultiplier times
  const damageRolls = crit ? weapon.critMultiplier : 1;
  let damage = 0;
  for (let i = 0; i < damageRolls; i++) damage += rollDiceExpression(rng, weapon.damage) + damageModifier(attacker);
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

export type SpellResult = { success: boolean; amount: number; log: string };

export function castSpell(rng: Rng, caster: Character, spell: Spell, target: Character): SpellResult {
  const fail = (reason: string) => ({ success: false, amount: 0, log: `${caster.name} ${reason}` });
  if (!canAct(caster)) return fail(`is ${lifeState(caster)} and cannot cast`);
  if (!canCast(caster, spell)) return fail(`cannot cast ${spell}: it is not a ${caster.characterClass} spell`);
  if (caster.spellSlots < 1) return fail("has no spell slots left");
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

// SRD: a full night's rest restores the spell slots and heals 1 hp per level.
// A dying character must first be stabilized, so it does not heal here.
export function rest(c: Character): string {
  c.spellSlots = spellSlotsPerDay(c);
  if (!canAct(c)) return `${c.name} rests (${lifeState(c)}, no healing): ${c.hp}/${c.maxHp}`;
  heal(c, c.level);
  return `${c.name} rests: ${c.hp}/${c.maxHp} hp, ${c.spellSlots} spell slots`;
}
