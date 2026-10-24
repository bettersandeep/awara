// Seeded dice. One generator per campaign; a seed makes the rules tests repeatable.
export type Rng = { next: () => number };

// mulberry32: small and fast, good enough for dice.
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function roll(rng: Rng, count: number, sides: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < count; i++) results.push(1 + Math.floor(rng.next() * sides));
  return results;
}

export const rollD20 = (rng: Rng) => roll(rng, 1, 20)[0];

// "2d6+3" -> rolled total. Supports NdS, NdS+M and NdS-M.
export function rollDiceExpression(rng: Rng, expression: string): number {
  const match = expression.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) throw new Error(`bad dice expression: ${expression}`);
  const [, count, sides, modifier] = match;
  const total = roll(rng, Number(count), Number(sides)).reduce((sum, value) => sum + value, 0);
  return total + (modifier ? Number(modifier) : 0);
}

export function pickRandom<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)];
}
