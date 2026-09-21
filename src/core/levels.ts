import { PUZZLE_COUNT } from './dice';
import { LEVEL_COUNT, PACKED_LEVELS } from './levels-data';

export { LEVEL_COUNT };

const LEVELS: Uint8Array = (() => {
  const bytes = Uint8Array.from(atob(PACKED_LEVELS), (c) => c.charCodeAt(0));
  const out = new Uint8Array(PUZZLE_COUNT);
  for (let i = 0; i < PUZZLE_COUNT; i++) out[i] = (bytes[i >> 1] >> ((i & 1) * 4)) & 0xf;
  return out;
})();

const BY_LEVEL: number[][] = (() => {
  const lists: number[][] = Array.from({ length: LEVEL_COUNT + 1 }, () => []);
  for (let seed = 0; seed < PUZZLE_COUNT; seed++) lists[LEVELS[seed]].push(seed);
  return lists;
})();

/** Difficulty of a puzzle, 1 (most solutions) to LEVEL_COUNT (fewest). */
export function levelOf(seed: number): number {
  return LEVELS[seed];
}

export function seedsAtLevel(level: number): readonly number[] {
  if (!Number.isInteger(level) || level < 1 || level > LEVEL_COUNT) {
    throw new RangeError(`Level must be 1..${LEVEL_COUNT}, got ${level}`);
  }
  return BY_LEVEL[level];
}

export function randomSeedForLevel(level: number, random: () => number = Math.random): number {
  const seeds = seedsAtLevel(level);
  return seeds[Math.floor(random() * seeds.length)];
}
