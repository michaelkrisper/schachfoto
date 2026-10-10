import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInfo } from '../public/js/engine.js';
import {
  START_PLACEMENT,
  boardToPlacement,
  buildFen,
  canAdd,
  defaultCastling,
  formatScore,
  orientByPawns,
  parseRanks,
  placeProblem,
  placementProblem,
  placementToBoard,
  rotateBoard,
  squareIndex,
  squareName,
} from '../public/js/position.js';

test('square names and indices round-trip', () => {
  assert.equal(squareName(0), 'a8');
  assert.equal(squareName(63), 'h1');
  for (let i = 0; i < 64; i++) assert.equal(squareIndex(squareName(i)), i);
});

test('parseRanks accepts dots and digits', () => {
  const dots = parseRanks([
    'rnbqkbnr',
    'pppppppp',
    '........',
    '........',
    '........',
    '........',
    'PPPPPPPP',
    'RNBQKBNR',
  ]);
  assert.equal(boardToPlacement(dots), START_PLACEMENT);
  assert.deepEqual(placementToBoard(START_PLACEMENT), dots);
});

test('parseRanks rejects malformed input', () => {
  assert.throws(() => parseRanks(['8', '8', '8', '8', '8', '8', '8']));
  assert.throws(() => parseRanks(['7', '8', '8', '8', '8', '8', '8', '8']));
  assert.throws(() => parseRanks(['x7', '8', '8', '8', '8', '8', '8', '8']));
});

test('rotateBoard swaps sides', () => {
  const rotated = rotateBoard(placementToBoard(START_PLACEMENT));
  assert.equal(boardToPlacement(rotated), 'RNBKQBNR/PPPPPPPP/8/8/8/8/pppppppp/rnbkqbnr');
});

test('defaultCastling follows king and rook home squares', () => {
  assert.equal(defaultCastling(placementToBoard(START_PLACEMENT)), 'KQkq');
  assert.equal(defaultCastling(placementToBoard('4k3/8/8/8/8/8/8/R3K3')), 'Q');
  assert.equal(buildFen(placementToBoard('4k3/8/8/8/8/8/8/4K3'), 'b', ''), '4k3/8/8/8/8/8/8/4K3 b - - 0 1');
});

test('placementProblem finds impossible setups', () => {
  assert.equal(placementProblem(placementToBoard(START_PLACEMENT)), null);
  assert.match(placementProblem(placementToBoard('8/8/8/8/8/8/8/4K3')), /Schwarz/);
  assert.match(placementProblem(placementToBoard('P3k3/8/8/8/8/8/8/4K3')), /Bauern/);
});

test('formatScore shows white perspective', () => {
  assert.equal(formatScore({ type: 'cp', value: 130 }, 'w'), '+1.3');
  assert.equal(formatScore({ type: 'cp', value: 130 }, 'b'), '-1.3');
  assert.equal(formatScore({ type: 'mate', value: 2 }, 'b'), '-#2');
  assert.equal(formatScore({ type: 'cp', value: 0 }, 'w'), '0.0');
});

test('parseInfo reads multipv lines', () => {
  const info = parseInfo(
    'info depth 14 seldepth 20 multipv 2 score cp -35 nodes 1234 nps 50000 time 25 pv e7e5 g1f3 b8c6',
  );
  assert.deepEqual(info, {
    depth: 14,
    multipv: 2,
    score: { type: 'cp', value: -35 },
    pv: ['e7e5', 'g1f3', 'b8c6'],
  });
  assert.equal(parseInfo('info depth 3 currmove e2e4 currmovenumber 1'), null);
  assert.equal(parseInfo('info depth 10 score mate 3 pv h5f7').score.type, 'mate');
});

test('orientByPawns turns a board read from black side', () => {
  const after_e4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
  const upsideDown = 'RNBKQBNR/PPP1PPPP/8/3P4/8/8/pppppppp/rnbkqbnr';
  assert.equal(boardToPlacement(orientByPawns(placementToBoard(upsideDown))), after_e4);
  assert.equal(boardToPlacement(orientByPawns(placementToBoard(after_e4))), after_e4);
  assert.equal(
    boardToPlacement(orientByPawns(placementToBoard('4k3/8/8/8/8/8/8/4K3'))),
    '4k3/8/8/8/8/8/8/4K3',
  );
});

test('piece limits follow what a real game allows', () => {
  const start = placementToBoard(START_PLACEMENT);
  assert.equal(canAdd(start, 'Q'), false);
  assert.equal(canAdd(start, 'k'), false);
  assert.equal(canAdd(start, ''), true);
  // Without one white pawn, a second queen is possible (promotion).
  const noPawn = placementToBoard('rnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR');
  assert.equal(canAdd(noPawn, 'Q'), true);
  assert.equal(canAdd(noPawn, 'q'), false);
  assert.match(placeProblem(start, squareIndex('e4'), 'N'), /Weiß/);
  assert.match(placeProblem(noPawn, squareIndex('a8'), 'P'), /Bauern/);
  assert.match(placeProblem(start, squareIndex('e4'), 'K'), /König/);
  // Replacing a pawn by a second queen is a promotion, so it fits.
  assert.equal(placeProblem(start, squareIndex('e2'), 'Q'), null);
  assert.match(placementProblem(placementToBoard('QQQQkQQQ/QQQ5/8/8/8/8/8/4K3')), /Weiß hat mehr/);
});
