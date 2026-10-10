import { renderBoard, pieceSrc } from './board.js';
import { Engine } from './engine.js';
import { prepareImage } from './photo.js';
import {
  EMPTY_BOARD,
  START_PLACEMENT,
  boardToPlacement,
  buildFen,
  defaultCastling,
  formatScore,
  placementProblem,
  placementToBoard,
  rotateBoard,
  squareIndex,
  squareName,
} from './position.js';
import { Chess } from '../vendor/chess.js';

const $ = (sel) => document.querySelector(sel);
const STORE_KEY = 'sf_state';
const CODE_KEY = 'sf_code';
const PALETTE = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p', ''];
const GERMAN_PIECES = { N: 'S', B: 'L', R: 'T', Q: 'D' };

const engine = new Engine();
const state = {
  board: [...EMPTY_BOARD],
  turn: 'w',
  castleOff: new Set(),
  marked: [],
  selected: 'P',
  mode: 'edit',
  flipped: false,
  lines: [],
  // Play mode: the game, earlier positions for undo, and the tap/drag selection.
  game: null,
  past: [],
  startTurn: 'w',
  lastMove: null,
  pick: null,
  targets: [],
  dragFrom: null,
};
let recognizeAbort = null;
let analysisRun = 0;

// ---------- persistence ----------

function save() {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      placement: boardToPlacement(state.board),
      turn: state.turn,
      castleOff: [...state.castleOff],
    }),
  );
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!saved) return false;
    state.board = placementToBoard(saved.placement);
    state.turn = saved.turn === 'b' ? 'b' : 'w';
    state.castleOff = new Set(saved.castleOff);
    state.flipped = state.turn === 'b';
    return true;
  } catch {
    return false;
  }
}

// ---------- views ----------

function show(view) {
  for (const id of ['start', 'busy', 'board']) $(`#view-${id}`).hidden = id !== view;
  $('#btn-home').hidden = view === 'start';
  if (view === 'start') $('#btn-last').hidden = !localStorage.getItem(STORE_KEY);
}

function castling() {
  return [...defaultCastling(state.board)].filter((c) => !state.castleOff.has(c)).join('');
}

function setError(el, msg) {
  el.textContent = msg ?? '';
  el.hidden = !msg;
}

function render() {
  const analysing = state.mode === 'analysis';
  renderBoard($('#board'), {
    board: state.board,
    flipped: state.flipped,
    marked: analysing ? [] : state.marked,
    arrows:
      analysing && state.pick === null
        ? state.lines.map((l, rank) => ({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), rank }))
        : [],
    onSquare: analysing ? null : tapSquare,
    pick: analysing ? state.pick : null,
    targets: analysing ? state.targets : [],
    lastMove: analysing ? state.lastMove : null,
    dragFrom: state.dragFrom,
  });
  $('#board').classList.toggle('play', analysing);
  $('#edit-tools').hidden = analysing;
  $('#note').hidden = analysing || !$('#note').textContent;
  $('#analysis-tools').hidden = !analysing;
  if (analysing) renderPlayInfo();

  for (const btn of document.querySelectorAll('[data-turn]')) {
    btn.setAttribute('aria-checked', String(btn.dataset.turn === state.turn));
  }
  const possible = defaultCastling(state.board);
  for (const box of document.querySelectorAll('[data-castle]')) {
    const c = box.dataset.castle;
    box.disabled = !possible.includes(c);
    box.checked = possible.includes(c) && !state.castleOff.has(c);
  }
  for (const btn of $('#palette').children) {
    btn.setAttribute('aria-checked', String(btn.dataset.piece === state.selected));
  }
}

function buildPalette() {
  for (const piece of PALETTE) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'radio';
    btn.dataset.piece = piece;
    if (piece) {
      const img = document.createElement('img');
      img.src = pieceSrc(piece);
      img.alt = piece;
      btn.append(img);
    } else {
      btn.textContent = 'leer';
      btn.classList.add('eraser');
    }
    btn.addEventListener('click', () => {
      state.selected = piece;
      render();
    });
    $('#palette').append(btn);
  }
}

// ---------- editing ----------

function tapSquare(index) {
  const piece = state.board[index] === state.selected ? '' : state.selected;
  state.board[index] = piece;
  state.marked = state.marked.filter((sq) => sq !== squareName(index));
  setError($('#error'), null);
  save();
  render();
}

function loadPlacement(placement, { recognized = false, marked = [], note = '' } = {}) {
  state.board = placementToBoard(placement);
  state.castleOff.clear();
  state.marked = marked;
  state.mode = 'edit';
  state.flipped = state.turn === 'b';
  const hint = marked.length
    ? 'Gelb markierte Felder sind unsicher, bitte prüfen.'
    : 'Bitte Stellung prüfen.';
  setError($('#note'), recognized ? [hint, note].filter(Boolean).join(' ') : null);
  setError($('#error'), null);
  save();
  show('board');
  render();
}

// ---------- recognition ----------

async function askCode() {
  const dlg = $('#dlg-code');
  $('#in-code').value = '';
  dlg.showModal();
  await new Promise((resolve) => dlg.addEventListener('close', resolve, { once: true }));
  if (dlg.returnValue !== 'ok') return false;
  localStorage.setItem(CODE_KEY, $('#in-code').value.trim());
  return true;
}

async function recognize(file) {
  if (!file) return;
  setError($('#start-error'), null);
  let prepared;
  try {
    prepared = await prepareImage(file);
  } catch {
    setError($('#start-error'), 'Das Bild konnte nicht gelesen werden.');
    return;
  }
  $('#busy-photo').src = prepared.dataUrl;
  show('busy');

  for (;;) {
    recognizeAbort = new AbortController();
    let res;
    try {
      res = await fetch('/api/recognize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-access-code': localStorage.getItem(CODE_KEY) ?? '',
        },
        body: JSON.stringify({ image: prepared.image, mediaType: prepared.mediaType }),
        signal: recognizeAbort.signal,
      });
    } catch (err) {
      show('start');
      if (err.name !== 'AbortError') setError($('#start-error'), 'Keine Verbindung zum Server.');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (await askCode()) continue;
      show('start');
      return;
    }
    if (!res.ok) {
      show('start');
      setError($('#start-error'), body.error ?? `Fehler ${res.status}`);
      return;
    }
    loadPlacement(body.placement, { recognized: true, marked: body.uncertain, note: body.note });
    return;
  }
}

// ---------- analysis ----------

function toGerman(san) {
  return san.replace(/[NBRQ]/g, (p) => GERMAN_PIECES[p]);
}

function pvToSan(fen, pv) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, 8)) {
    try {
      out.push(toGerman(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san));
    } catch {
      break;
    }
  }
  return out;
}

function positionProblem(fen) {
  const problem = placementProblem(state.board);
  if (problem) return problem;
  let chess;
  try {
    chess = new Chess(fen);
  } catch (err) {
    return `Ungültige Stellung: ${err.message}`;
  }
  const other = new Chess(fen.replace(` ${state.turn} `, ` ${state.turn === 'w' ? 'b' : 'w'} `), {
    skipValidation: true,
  });
  if (other.isCheck()) {
    const side = state.turn === 'w' ? 'Schwarz' : 'Weiß';
    return `${side} steht im Schach, ist aber nicht am Zug. Stimmt „am Zug"?`;
  }
  if (chess.isCheckmate()) return 'Schachmatt – hier gibt es keinen Zug mehr.';
  if (chess.isStalemate()) return 'Patt – hier gibt es keinen Zug mehr.';
  return null;
}

function gameResult() {
  const g = state.game;
  if (g.isCheckmate()) return `Schachmatt – ${g.turn() === 'w' ? 'Schwarz' : 'Weiß'} gewinnt.`;
  if (g.isStalemate()) return 'Patt – Remis.';
  if (g.isInsufficientMaterial()) return 'Remis – zu wenig Material.';
  if (g.isThreefoldRepetition()) return 'Remis durch Stellungswiederholung.';
  if (g.isDraw()) return 'Remis nach der 50-Züge-Regel.';
  return null;
}

function historyText() {
  const parts = [];
  let number = 1;
  let white = state.startTurn === 'w';
  if (!white && state.past.length) parts.push('1…');
  for (const { san } of state.past) {
    if (white) parts.push(`${number}.`);
    parts.push(san);
    if (!white) number++;
    white = !white;
  }
  return parts.join(' ');
}

function renderPlayInfo() {
  const result = gameResult();
  const side = state.game.turn() === 'w' ? 'Weiß' : 'Schwarz';
  $('#status').textContent = result ?? `${side} am Zug${state.game.isCheck() ? ' – Schach!' : ''}`;
  const moves = $('#moves');
  moves.textContent = historyText() || 'Ziehe per Drag & Drop, Antippen oder über einen Vorschlag.';
  moves.scrollLeft = moves.scrollWidth;
  $('#btn-undo').disabled = !state.past.length;
  $('#btn-pass').disabled = Boolean(result);
}

function renderLines(fen, lines) {
  state.lines = lines;
  const list = $('#lines');
  list.replaceChildren();
  for (const line of lines) {
    const san = pvToSan(fen, line.pv);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'line';
    const move = document.createElement('strong');
    move.textContent = san[0] ?? line.pv[0];
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = formatScore(line.score, state.turn);
    const cont = document.createElement('small');
    cont.textContent = san.slice(1).join(' ');
    btn.append(move, score, cont);
    const uci = line.pv[0];
    btn.addEventListener('click', () =>
      playMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }),
    );
    const li = document.createElement('li');
    li.append(btn);
    list.append(li);
  }
  const depth = lines.length ? Math.min(...lines.map((l) => l.depth)) : 0;
  if (state.game && gameResult()) $('#depth').textContent = '';
  else $('#depth').textContent = depth ? `Tiefe ${depth} · + = Vorteil Weiß` : 'Rechne …';
  render();
}

async function runEngine(movetime = 6000) {
  const run = ++analysisRun;
  const fen = state.game.fen();
  $('#btn-longer').disabled = true;
  if (gameResult()) {
    engine.stop();
    renderLines(fen, []);
    return;
  }
  renderLines(fen, []);
  let frame = 0;
  const lines = await engine.analyse(fen, {
    movetime,
    onUpdate: (current) => {
      if (run !== analysisRun) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => renderLines(fen, current));
    },
  });
  if (run !== analysisRun) return;
  cancelAnimationFrame(frame);
  renderLines(fen, lines);
  $('#btn-longer').disabled = false;
}

function startPlay() {
  const fen = buildFen(state.board, state.turn, castling());
  const problem = positionProblem(fen);
  if (problem) {
    setError($('#error'), problem);
    return;
  }
  state.game = new Chess(fen);
  state.past = [];
  state.startTurn = state.turn;
  state.lastMove = null;
  clearPick();
  state.mode = 'analysis';
  runEngine();
}

function backToEdit() {
  analysisRun++;
  engine.stop();
  clearPick();
  state.mode = 'edit';
  render();
}

// ---------- playing moves ----------

function syncFromGame() {
  const [placement, turn, rights] = state.game.fen().split(' ');
  state.board = placementToBoard(placement);
  state.turn = turn;
  state.castleOff = new Set([...defaultCastling(state.board)].filter((c) => !rights.includes(c)));
  save();
}

function afterChange() {
  clearPick();
  setError($('#play-error'), null);
  syncFromGame();
  runEngine();
}

function playMove(move) {
  const before = state.game.fen();
  let result;
  try {
    result = state.game.move(move);
  } catch {
    clearPick();
    render();
    return;
  }
  state.past.push({ fen: before, san: toGerman(result.san), squares: [result.from, result.to] });
  state.lastMove = [result.from, result.to];
  afterChange();
}

function undo() {
  const prev = state.past.pop();
  if (!prev) return;
  state.game = new Chess(prev.fen);
  state.lastMove = state.past.at(-1)?.squares ?? null;
  afterChange();
}

// Lets the other side move next, e.g. when the photo was taken with the wrong player to move.
function passTurn() {
  if (state.game.isCheck()) {
    setError($('#play-error'), 'Wer im Schach steht, muss selbst ziehen.');
    return;
  }
  const parts = state.game.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  state.past.push({ fen: state.game.fen(), san: '–', squares: null });
  state.game = new Chess(parts.join(' '));
  state.lastMove = null;
  afterChange();
}

function isOwn(piece) {
  return (piece === piece.toUpperCase()) === (state.game.turn() === 'w');
}

function pickSquare(index) {
  state.pick = index;
  state.targets = state.game
    .moves({ square: squareName(index), verbose: true })
    .map((m) => squareIndex(m.to));
}

function clearPick() {
  state.pick = null;
  state.targets = [];
}

async function choosePromotion(color) {
  const dlg = $('#dlg-promo');
  const box = $('#promo-pieces');
  box.replaceChildren();
  for (const p of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.value = p;
    const img = document.createElement('img');
    img.src = pieceSrc(color === 'w' ? p.toUpperCase() : p);
    img.alt = p;
    btn.append(img);
    box.append(btn);
  }
  dlg.returnValue = '';
  dlg.showModal();
  await new Promise((resolve) => dlg.addEventListener('close', resolve, { once: true }));
  return dlg.returnValue || null;
}

async function tryMove(from, to) {
  const toName = squareName(to);
  const legal = state.game.moves({ square: squareName(from), verbose: true }).filter((m) => m.to === toName);
  if (!legal.length) {
    clearPick();
    render();
    return;
  }
  let promotion;
  if (legal.some((m) => m.promotion)) {
    promotion = await choosePromotion(state.game.turn());
    if (!promotion) {
      clearPick();
      render();
      return;
    }
  }
  playMove({ from: squareName(from), to: toName, promotion });
}

function tapPlay(index) {
  if (state.pick !== null && state.targets.includes(index)) {
    tryMove(state.pick, index);
    return;
  }
  const piece = state.board[index];
  if (piece && isOwn(piece) && index !== state.pick) pickSquare(index);
  else clearPick();
  render();
}

// Drag & drop and tap-tap moves share one pointer handler: a press that moves
// more than a few pixels drags the piece, anything else counts as a tap.
function setupPlayInput() {
  const root = $('#board');
  let press = null;
  const indexAt = (x, y) => {
    const sq = document.elementFromPoint(x, y)?.closest('#board .sq');
    return sq ? Number(sq.dataset.index) : null;
  };

  root.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'analysis' || !e.isPrimary) return;
    const index = indexAt(e.clientX, e.clientY);
    if (index === null) return;
    const piece = state.board[index];
    press = { index, x: e.clientX, y: e.clientY, ghost: null };
    press.draggable = Boolean(piece) && isOwn(piece) && !gameResult();
    if (press.draggable) root.setPointerCapture(e.pointerId);
  });

  root.addEventListener('pointermove', (e) => {
    if (!press?.draggable) return;
    if (!press.ghost) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      const size = (root.getBoundingClientRect().width / 8) * 1.2;
      press.ghost = document.createElement('img');
      press.ghost.src = pieceSrc(state.board[press.index]);
      press.ghost.className = 'drag-ghost';
      press.ghost.style.width = `${size}px`;
      press.ghost.style.height = `${size}px`;
      document.body.append(press.ghost);
      pickSquare(press.index);
      state.dragFrom = press.index;
      render();
    }
    press.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -60%)`;
  });

  const finish = (e, cancelled) => {
    if (!press) return;
    const { index, ghost } = press;
    press = null;
    if (ghost) {
      ghost.remove();
      state.dragFrom = null;
      const to = cancelled ? null : indexAt(e.clientX, e.clientY);
      if (to !== null && to !== index) tryMove(index, to);
      else render();
    } else if (!cancelled) {
      tapPlay(index);
    }
  };
  root.addEventListener('pointerup', (e) => finish(e, false));
  root.addEventListener('pointercancel', (e) => finish(e, true));
}

// Native feel: no pinch zoom, no double-tap zoom, no rubber-band scrolling.
function blockZoom() {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  let lastTouch = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouch < 300 && !e.target.closest('input')) e.preventDefault();
      lastTouch = now;
    },
    { passive: false },
  );
}

// ---------- wiring ----------

function init() {
  buildPalette();
  setupPlayInput();
  blockZoom();

  $('#in-camera').addEventListener('change', (e) =>
    recognize(e.target.files[0]).finally(() => (e.target.value = '')),
  );
  $('#in-file').addEventListener('change', (e) =>
    recognize(e.target.files[0]).finally(() => (e.target.value = '')),
  );
  $('#btn-manual').addEventListener('click', () => loadPlacement(START_PLACEMENT));
  $('#btn-cancel').addEventListener('click', () => recognizeAbort?.abort());
  $('#btn-home').addEventListener('click', () => {
    backToEdit();
    show('start');
  });

  for (const btn of document.querySelectorAll('[data-turn]')) {
    btn.addEventListener('click', () => {
      state.turn = btn.dataset.turn;
      state.flipped = state.turn === 'b';
      setError($('#error'), null);
      save();
      render();
    });
  }
  for (const box of document.querySelectorAll('[data-castle]')) {
    box.addEventListener('change', () => {
      if (box.checked) state.castleOff.delete(box.dataset.castle);
      else state.castleOff.add(box.dataset.castle);
      save();
    });
  }
  $('#btn-rotate').addEventListener('click', () => {
    state.board = rotateBoard(state.board);
    state.marked = [];
    save();
    render();
  });
  $('#btn-start-pos').addEventListener('click', () => loadPlacement(START_PLACEMENT));
  $('#btn-clear').addEventListener('click', () => loadPlacement(boardToPlacement(EMPTY_BOARD)));
  $('#btn-analyse').addEventListener('click', startPlay);
  $('#btn-longer').addEventListener('click', () => runEngine(20000));
  $('#btn-edit').addEventListener('click', backToEdit);
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-pass').addEventListener('click', passTurn);
  $('#btn-flip').addEventListener('click', () => {
    state.flipped = !state.flipped;
    render();
  });

  $('#btn-last').hidden = !restore();
  $('#btn-last').addEventListener('click', () => {
    state.marked = [];
    state.mode = 'edit';
    setError($('#note'), null);
    show('board');
    render();
  });
  render();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
}

init();
