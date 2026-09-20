# Genius Square

A web version of the board game **The Genius Square**, built for an iPad, an iPhone, and any desktop browser. Progressive web app: no App Store, "Add to Home Screen" in Safari.

## Rules

Roll seven dice, put a blocker on each square rolled, then fill the other 29 squares with the nine pieces. Pieces rotate and flip. Every roll is solvable.

## Develop

```sh
npm install
npm run dev          # local server
npm test             # fast unit tests
RUN_SLOW=1 npm test  # also proves all 62,208 rolls are solvable (~5 s)
npm run build        # production build in dist/
```

## Layout

- `src/core/` pure game logic, no DOM: pieces and orientations, the exact dice tables, the board, and a backtracking solver (hints, solution counts).
- `src/ui/` board rendering and touch input.
- `src/main.ts` entry point.
