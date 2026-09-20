import type { Cell } from './pieces';

/**
 * The seven dice from the physical game, face by face. These exact tables are
 * what make every roll solvable; never substitute random squares.
 */
export const DICE: readonly (readonly string[])[] = [
  ['A1', 'C1', 'D1', 'D2', 'E2', 'F3'],
  ['A2', 'B2', 'C2', 'A3', 'B1', 'B3'],
  ['C3', 'D3', 'E3', 'B4', 'C4', 'D4'],
  ['E1', 'F2', 'F2', 'B6', 'A5', 'A5'],
  ['A4', 'B5', 'C6', 'C5', 'D6', 'F6'],
  ['E4', 'F4', 'E5', 'F5', 'D5', 'E6'],
  ['F1', 'F1', 'F1', 'A6', 'A6', 'A6'],
];

/** Each die's faces with duplicates removed, in first-seen order. Used to number puzzles. */
const UNIQUE_FACES: readonly (readonly string[])[] = DICE.map((die) => [...new Set(die)]);

/** Number of distinct blocker layouts: 6 * 6 * 6 * 4 * 6 * 6 * 2. */
export const PUZZLE_COUNT: number = UNIQUE_FACES.reduce((n, die) => n * die.length, 1);

const COLUMNS = 'ABCDEF';

/** "C2" -> { r: 1, c: 2 }. Column letter first, then row number, as printed on the dice. */
export function parseSquare(name: string): Cell {
  const c = COLUMNS.indexOf(name[0]);
  const r = Number(name.slice(1)) - 1;
  if (c < 0 || !Number.isInteger(r) || r < 0 || r > 5) {
    throw new Error(`Bad square name: ${name}`);
  }
  return { r, c };
}

/** { r: 1, c: 2 } -> "C2". */
export function squareName(cell: Cell): string {
  return `${COLUMNS[cell.c]}${cell.r + 1}`;
}

/** Roll all seven dice. `random` must return a number in [0, 1). */
export function roll(random: () => number = Math.random): Cell[] {
  return DICE.map((die) => parseSquare(die[Math.floor(random() * die.length)]));
}

/**
 * Deterministic roll from a puzzle number in [0, PUZZLE_COUNT). Every number is
 * a different blocker set, so two devices can share a puzzle by its number.
 */
export function rollFromSeed(seed: number): Cell[] {
  if (!Number.isInteger(seed) || seed < 0 || seed >= PUZZLE_COUNT) {
    throw new RangeError(`Seed must be an integer in [0, ${PUZZLE_COUNT}), got ${seed}`);
  }
  const cells: Cell[] = [];
  let rest = seed;
  for (const faces of UNIQUE_FACES) {
    cells.push(parseSquare(faces[rest % faces.length]));
    rest = Math.floor(rest / faces.length);
  }
  return cells;
}
