import { describe, expect, test } from 'vitest';
import { Game } from './game';
import { rollFromSeed, squareName } from './dice';
import { PIECES } from './pieces';

describe('Game', () => {
  test('a new game rolls the blockers for its seed and starts with all pieces in the tray', () => {
    const game = new Game(42);
    expect(game.seed).toBe(42);
    expect(game.blockers.map(squareName)).toEqual(rollFromSeed(42).map(squareName));
    expect(game.board.emptyCount()).toBe(29);
    expect(game.pieces().filter((p) => p.placed)).toHaveLength(0);
    expect(game.pieces()).toHaveLength(9);
  });

  test('without a seed it picks a random valid puzzle', () => {
    const game = new Game();
    expect(game.seed).toBeGreaterThanOrEqual(0);
    expect(game.blockers).toHaveLength(7);
  });

  test('each tray piece starts in its first orientation', () => {
    const game = new Game(1);
    for (const piece of PIECES) expect(game.orientation(piece.id)).toEqual(piece.orientations[0]);
  });

  test('rotate turns a piece a quarter turn clockwise', () => {
    const game = new Game(1);
    game.rotate('bar3'); // horizontal -> vertical
    expect(game.orientation('bar3')).toEqual([{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }]);
    game.rotate('bar3');
    expect(game.orientation('bar3')).toEqual([{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }]);
  });

  test('flip mirrors a piece left to right', () => {
    const game = new Game(1);
    // smallL starts as (0,0) (1,0) (1,1); mirrored it is (0,1) (1,0) (1,1)
    game.flip('smallL');
    expect(game.orientation('smallL')).toEqual([{ r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }]);
  });

  test('drop places the piece in its current orientation and reports success', () => {
    const game = new Game(0); // blockers A1 A2 C3 E1 A4 E4 F1
    game.rotate('bar3');
    expect(game.drop('bar3', { r: 1, c: 5 })).toBe(true); // B6 C6 D6 are free
    expect(game.board.get({ r: 3, c: 5 })).toBe('bar3');
    expect(game.pieces().find((p) => p.id === 'bar3')!.placed).toBe(true);
  });

  test('drop on an illegal spot returns false and leaves the board unchanged', () => {
    const game = new Game(0);
    expect(game.drop('dot', { r: 0, c: 0 })).toBe(false); // A1 is a blocker
    expect(game.board.emptyCount()).toBe(29);
  });

  test('dropping a placed piece somewhere else moves it', () => {
    const game = new Game(0);
    game.drop('dot', { r: 5, c: 5 });
    expect(game.drop('dot', { r: 4, c: 4 })).toBe(true);
    expect(game.board.get({ r: 5, c: 5 })).toBeNull();
    expect(game.board.get({ r: 4, c: 4 })).toBe('dot');
  });

  test('a failed move of a placed piece puts it back where it was', () => {
    const game = new Game(0);
    game.drop('dot', { r: 5, c: 5 });
    expect(game.drop('dot', { r: 0, c: 0 })).toBe(false);
    expect(game.board.get({ r: 5, c: 5 })).toBe('dot');
  });

  test('pickUp returns a piece to the tray', () => {
    const game = new Game(0);
    game.drop('dot', { r: 5, c: 5 });
    game.pickUp('dot');
    expect(game.board.get({ r: 5, c: 5 })).toBeNull();
    expect(game.pieces().find((p) => p.id === 'dot')!.placed).toBe(false);
  });

  test('rotating a placed piece lifts it back to the tray', () => {
    const game = new Game(0);
    game.rotate('bar3');
    game.drop('bar3', { r: 1, c: 5 });
    game.rotate('bar3');
    expect(game.board.get({ r: 1, c: 5 })).toBeNull();
    expect(game.pieces().find((p) => p.id === 'bar3')!.placed).toBe(false);
  });

  test('hint places one correct piece and sets its orientation to match', () => {
    const game = new Game(7);
    const h = game.hint();
    expect(h).not.toBeNull();
    expect(game.board.placements.get(h!.id)).toEqual({ cells: h!.cells, at: h!.at });
    expect(game.orientation(h!.id)).toEqual(h!.cells);
    expect(h!.cleared).toBe(false);
  });

  test('hint clears wrongly placed pieces when the current layout cannot be finished', () => {
    // Blockers for seed 0 leave B6 C6 D6 as a column; a vertical bar4 up column 6 is not possible,
    // so build an unfinishable state instead: put the dot where the solver needs something else.
    const game = new Game(0);
    // Place pieces until no solution exists, by brute force: try every empty cell for the dot.
    let stuck = false;
    for (let r = 0; r < 6 && !stuck; r++) {
      for (let c = 0; c < 6 && !stuck; c++) {
        if (game.drop('dot', { r, c }) && game.solvable() === false) stuck = true;
      }
    }
    expect(stuck).toBe(true);
    const h = game.hint();
    expect(h).not.toBeNull();
    expect(h!.cleared).toBe(true);
    expect(game.solvable()).toBe(true);
  });

  test('isSolved becomes true when the board is full', () => {
    const game = new Game(3);
    expect(game.isSolved()).toBe(false);
    while (!game.isSolved()) expect(game.hint()).not.toBeNull();
    expect(game.isSolved()).toBe(true);
    expect(game.hint()).toBeNull();
  });

  test('the clock runs from the roll and freezes when solved', () => {
    let now = 1000;
    const game = new Game(3, () => now);
    now = 4000;
    expect(game.elapsedMs()).toBe(3000);
    while (!game.isSolved()) game.hint();
    now = 9000;
    expect(game.elapsedMs()).toBe(3000);
  });

  test('reset starts a new puzzle with everything back in the tray', () => {
    const game = new Game(3);
    game.drop('dot', { r: 5, c: 5 });
    game.reset(10);
    expect(game.seed).toBe(10);
    expect(game.board.emptyCount()).toBe(29);
    expect(game.pieces().every((p) => !p.placed)).toBe(true);
  });
});
