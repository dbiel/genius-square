import { expect, test } from 'vitest';
import { Board } from './board';
import { PUZZLE_COUNT, rollFromSeed } from './dice';
import { solve } from './solver';

// Slow (about 5 seconds). Run with: RUN_SLOW=1 npm test
test.skipIf(!process.env.RUN_SLOW)('all 62,208 puzzles are solvable', () => {
  const unsolvable: number[] = [];
  for (let seed = 0; seed < PUZZLE_COUNT; seed++) {
    if (solve(new Board(rollFromSeed(seed))) === null) unsolvable.push(seed);
  }
  expect(unsolvable).toEqual([]);
}, 600_000);
