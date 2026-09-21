# Genius Square

A web version of the board game **The Genius Square**, built for an iPad, an iPhone, and any desktop browser. Progressive web app: no App Store, "Add to Home Screen" in Safari.

## Rules

Roll seven dice, put a blocker on each square rolled, then fill the other 29 squares with the nine pieces. Pieces rotate and flip. Every roll is solvable.

## Difficulty levels

Every puzzle's solution count was computed once (`scripts/count-all.ts` across several processes, then `scripts/build-levels.ts`). Puzzles are ranked by that count and split into ten equal bands: level 1 has the most solutions, level 10 the fewest. The table lives in `src/core/levels-data.ts` (generated, one nibble per puzzle); raw counts are in `data/solution-counts.json`.

## Develop

```sh
npm install
npm run dev          # local server
npm test             # fast unit tests
RUN_SLOW=1 npm test  # also proves all 62,208 rolls are solvable (~5 s)
npx tsx scripts/count-all.ts 0 1 counts.json   # recount every puzzle's solutions (~50 min on one core)
npx tsx scripts/build-levels.ts counts.json    # regenerate the level table
npm run build        # production build in dist/
```

## Layout

- `src/core/` pure game logic, no DOM: pieces and orientations, the exact dice tables, the board, and a backtracking solver (hints, solution counts).
- `src/ui/` board rendering and touch input.
- `src/main.ts` entry point.
