// Board model: 64 cells, index 0 = a8, 7 = h8, 56 = a1, 63 = h1.
// Each cell is '' or a FEN piece letter (uppercase = white).

const PIECE_RE = /^[prnbqkPRNBQK]$/;

export const EMPTY_BOARD = Object.freeze(Array(64).fill(''));
export const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

export function squareName(index) {
  return 'abcdefgh'[index % 8] + (8 - Math.floor(index / 8));
}

export function squareIndex(name) {
  return (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
}

// Accepts eight rank strings (rank 8 first) using '.' or digits for empty squares.
export function parseRanks(ranks) {
  if (!Array.isArray(ranks) || ranks.length !== 8) throw new Error('expected 8 ranks');
  const board = [];
  for (const rank of ranks) {
    const row = [];
    for (const ch of String(rank).replace(/\s/g, '')) {
      if (ch === '.') row.push('');
      else if (/[1-8]/.test(ch)) row.push(...Array(Number(ch)).fill(''));
      else if (PIECE_RE.test(ch)) row.push(ch);
      else throw new Error(`invalid character ${ch}`);
    }
    if (row.length !== 8) throw new Error(`rank "${rank}" has ${row.length} squares`);
    board.push(...row);
  }
  return board;
}

export function placementToBoard(placement) {
  return parseRanks(placement.split('/'));
}

export function boardToPlacement(board) {
  const ranks = [];
  for (let r = 0; r < 8; r++) {
    let out = '';
    let empty = 0;
    for (const cell of board.slice(r * 8, r * 8 + 8)) {
      if (cell) {
        if (empty) out += empty;
        out += cell;
        empty = 0;
      } else {
        empty++;
      }
    }
    ranks.push(empty ? out + empty : out);
  }
  return ranks.join('/');
}

// Fixes a recognition that read the board from the wrong side.
export function rotateBoard(board) {
  return [...board].reverse();
}

// A photo taken from black's side without coordinates reads as rotated by 180°.
// White pawns start on rank 2 and advance upwards, so in a real game they stand
// lower on average than black's; if not, the board was read upside down.
export function orientByPawns(board) {
  const meanRow = (piece) => {
    const rows = board.flatMap((c, i) => (c === piece ? [Math.floor(i / 8)] : []));
    return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
  };
  const white = meanRow('P');
  const black = meanRow('p');
  if (white === null || black === null) return board;
  return white < black ? rotateBoard(board) : board;
}

// Castling is allowed only if king and rook still stand on their home squares;
// whether they moved before cannot be seen on a photo.
export function defaultCastling(board) {
  const at = (sq) => board[squareIndex(sq)];
  let rights = '';
  if (at('e1') === 'K') {
    if (at('h1') === 'R') rights += 'K';
    if (at('a1') === 'R') rights += 'Q';
  }
  if (at('e8') === 'k') {
    if (at('h8') === 'r') rights += 'k';
    if (at('a8') === 'r') rights += 'q';
  }
  return rights;
}

const START_COUNTS = { q: 1, r: 2, b: 2, n: 2 };

// A side has one king and at most eight pawns; every piece beyond the starting
// set must be a promoted pawn. That also caps a side at 16 pieces.
export function exceedsLimits(board, white) {
  const count = (p) => board.filter((c) => c === (white ? p.toUpperCase() : p)).length;
  if (count('k') > 1) return true;
  const promoted = Object.entries(START_COUNTS).reduce((sum, [p, n]) => sum + Math.max(0, count(p) - n), 0);
  return count('p') + promoted > 8;
}

export function isWhite(piece) {
  return piece === piece.toUpperCase();
}

// Whether one more `piece` fits on the board without breaking the limits.
export function canAdd(board, piece) {
  return !piece || !exceedsLimits([...board, piece], isWhite(piece));
}

// German reason why `piece` ('' = empty) may not go on `index`, else null.
export function placeProblem(board, index, piece) {
  if (!piece) return null;
  if ((piece === 'P' || piece === 'p') && (index < 8 || index >= 56)) {
    return 'Bauern können nicht auf der 1. oder 8. Reihe stehen.';
  }
  const next = [...board];
  next[index] = piece;
  if (!exceedsLimits(next, isWhite(piece))) return null;
  if (piece.toLowerCase() === 'k') return 'Es gibt nur einen König pro Seite.';
  return `Mehr geht nicht: ${isWhite(piece) ? 'Weiß' : 'Schwarz'} hätte sonst mehr Figuren, als im Spiel möglich sind.`;
}

// Returns a German message for positions the engine cannot analyse, else null.
export function placementProblem(board) {
  const count = (p) => board.filter((c) => c === p).length;
  if (count('K') !== 1) return 'Weiß braucht genau einen König.';
  if (count('k') !== 1) return 'Schwarz braucht genau einen König.';
  if (exceedsLimits(board, true)) return 'Weiß hat mehr Figuren, als im Spiel möglich sind.';
  if (exceedsLimits(board, false)) return 'Schwarz hat mehr Figuren, als im Spiel möglich sind.';
  const backRanks = [...board.slice(0, 8), ...board.slice(56)];
  if (backRanks.some((c) => c === 'P' || c === 'p'))
    return 'Bauern dürfen nicht auf der 1. oder 8. Reihe stehen.';
  return null;
}

export function buildFen(board, turn, castling) {
  return `${boardToPlacement(board)} ${turn} ${castling || '-'} - 0 1`;
}

// Engine scores are from the side to move; display them from white's view.
export function formatScore(score, turn) {
  if (!score) return '';
  const sign = turn === 'w' ? 1 : -1;
  const v = score.value * sign;
  if (score.type === 'mate') {
    if (score.value === 0) return '#';
    return v > 0 ? `#${v}` : `-#${-v}`;
  }
  const pawns = v / 100;
  return (pawns > 0 ? '+' : '') + pawns.toFixed(1);
}
