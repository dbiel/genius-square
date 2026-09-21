import { Board } from '../src/core/board';
import { PUZZLE_COUNT, rollFromSeed } from '../src/core/dice';
import { countSolutions } from '../src/core/solver';

const n = Number(process.argv[2] ?? 300);
const counts: number[] = [];
const start = performance.now();
for (let i = 0; i < n; i++) {
  const seed = Math.floor((i / n) * PUZZLE_COUNT);
  counts.push(countSolutions(new Board(rollFromSeed(seed))));
}
const ms = performance.now() - start;
counts.sort((a, b) => a - b);
const pct = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))];
console.log(JSON.stringify({
  n, msPerPuzzle: +(ms / n).toFixed(1), min: counts[0], max: counts[counts.length - 1],
  p10: pct(0.1), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p90: pct(0.9), p99: pct(0.99),
  distinct: new Set(counts).size,
}));
