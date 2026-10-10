import { squareIndex, squareName } from './position.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function pieceSrc(piece) {
  const color = piece === piece.toUpperCase() ? 'w' : 'b';
  return `/pieces/${color}${piece.toUpperCase()}.svg`;
}

// Renders an 8x8 board into `root`. `flipped` puts black at the bottom.
export function renderBoard(root, { board, flipped, marked = [], arrows = [], onSquare }) {
  root.replaceChildren();
  const order = [...Array(64).keys()];
  if (flipped) order.reverse();

  for (const index of order) {
    const sq = document.createElement('button');
    sq.type = 'button';
    const file = index % 8;
    const rank = Math.floor(index / 8);
    sq.className = `sq ${(file + rank) % 2 ? 'dark' : 'light'}`;
    const name = squareName(index);
    if (marked.includes(name)) sq.classList.add('marked');
    sq.setAttribute('aria-label', name + (board[index] ? ` ${board[index]}` : ''));
    if (board[index]) {
      const img = document.createElement('img');
      img.src = pieceSrc(board[index]);
      img.alt = '';
      img.draggable = false;
      sq.append(img);
    }
    if (onSquare) sq.addEventListener('click', () => onSquare(index));
    else sq.tabIndex = -1;
    root.append(sq);
  }

  if (arrows.length) root.append(renderArrows(arrows, flipped));
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
