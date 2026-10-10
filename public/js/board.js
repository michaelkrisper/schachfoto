import { squareIndex, squareName } from './position.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function pieceSrc(piece) {
  const color = piece === piece.toUpperCase() ? 'w' : 'b';
  return `/pieces/${color}${piece.toUpperCase()}.svg`;
}

function coord(kind, text) {
  const span = document.createElement('span');
  span.className = `coord ${kind}`;
  span.textContent = text;
  span.setAttribute('aria-hidden', 'true');
  return span;
}

function renderSquare(index, opts) {
  const { board, marked = [], onSquare, pick = null, targets = [], lastMove = null, dragFrom = null } = opts;
  const sq = document.createElement('button');
  sq.type = 'button';
  const name = squareName(index);
  const piece = board[index];
  sq.className = `sq ${((index % 8) + Math.floor(index / 8)) % 2 ? 'dark' : 'light'}`;
  sq.dataset.index = index;
  sq.classList.toggle('marked', marked.includes(name));
  sq.classList.toggle('last', Boolean(lastMove?.includes(name)));
  sq.classList.toggle('picked', index === pick);
  if (targets.includes(index)) sq.classList.add(piece ? 'capture' : 'target');
  sq.setAttribute('aria-label', name + (piece ? ` ${piece}` : ''));
  // Coordinates sit in the left column and bottom row, whichever side is down.
  const edgeFile = opts.flipped ? 7 : 0;
  const edgeRank = opts.flipped ? 0 : 7;
  if (index % 8 === edgeFile) sq.append(coord('rank', name[1]));
  if (Math.floor(index / 8) === edgeRank) sq.append(coord('file', name[0]));
  if (piece) {
    const img = document.createElement('img');
    img.src = pieceSrc(piece);
    img.alt = '';
    img.draggable = false;
    img.classList.toggle('lifted', index === dragFrom);
    sq.append(img);
  }
  if (onSquare) sq.addEventListener('click', () => onSquare(index));
  else sq.tabIndex = -1;
  return sq;
}

// Renders an 8x8 board into `root`. `flipped` puts black at the bottom.
// Play-mode extras: `pick` (selected square), `targets` (its legal destinations),
// `lastMove` (two square names) and `dragFrom` (square whose piece is being dragged).
export function renderBoard(root, opts) {
  root.replaceChildren();
  const order = [...Array(64).keys()];
  if (opts.flipped) order.reverse();
  for (const index of order) root.append(renderSquare(index, opts));
  if (opts.arrows?.length) root.append(renderArrows(opts.arrows, opts.flipped));
}

function center(name, flipped) {
  const i = squareIndex(name);
  let x = (i % 8) + 0.5;
  let y = Math.floor(i / 8) + 0.5;
  if (flipped) {
    x = 8 - x;
    y = 8 - y;
  }
  return [x, y];
}

// arrows: [{ from: 'e2', to: 'e4', rank: 0 }] - rank 0 is the best move.
function renderArrows(arrows, flipped) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.classList.add('arrows');
  for (const { from, to, rank } of [...arrows].reverse()) {
    const [x1, y1] = center(from, flipped);
    const [x2, y2] = center(to, flipped);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const head = 0.42;
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add(`arrow-${rank}`);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2 - ux * head);
    line.setAttribute('y2', y2 - uy * head);
    const tip = document.createElementNS(SVG_NS, 'polygon');
    const bx = x2 - ux * head;
    const by = y2 - uy * head;
    const w = 0.28;
    tip.setAttribute('points', `${x2},${y2} ${bx - uy * w},${by + ux * w} ${bx + uy * w},${by - ux * w}`);
    g.append(line, tip);
    svg.append(g);
  }
  return svg;
}
