// Count solutions for every puzzle. Usage: tsx scripts/count-all.ts <worker> <workers> <outfile>
import { writeFileSync } from 'node:fs';
import { Board } from '../src/core/board';
import { PUZZLE_COUNT, rollFromSeed } from '../src/core/dice';
import { countSolutions } from '../src/core/solver';

const [worker, workers, outfile] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const out: number[] = [];
for (let seed = worker; seed < PUZZLE_COUNT; seed += workers) {
  out.push(countSolutions(new Board(rollFromSeed(seed))));
}
writeFileSync(outfile, JSON.stringify({ worker, workers, counts: out }));
console.log(`worker ${worker} done: ${out.length} puzzles`);
