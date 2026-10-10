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
  lines: [],
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
    flipped: state.turn === 'b',
    marked: analysing ? [] : state.marked,
    arrows: analysing
      ? state.lines.map((l, rank) => ({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), rank }))
      : [],
    onSquare: analysing ? null : tapSquare,
  });
  $('#edit-tools').hidden = analysing;
  $('#note').hidden = analysing || !$('#note').textContent;
  $('#analysis-tools').hidden = !analysing;

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

function renderLines(fen, lines) {
  state.lines = lines;
  const list = $('#lines');
  list.replaceChildren();
  for (const line of lines) {
    const san = pvToSan(fen, line.pv);
    const li = document.createElement('li');
    const move = document.createElement('strong');
    move.textContent = san[0] ?? line.pv[0];
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = formatScore(line.score, state.turn);
    const cont = document.createElement('small');
    cont.textContent = san.slice(1).join(' ');
    li.append(move, score, cont);
    list.append(li);
  }
  const depth = lines.length ? Math.min(...lines.map((l) => l.depth)) : 0;
  $('#depth').textContent = depth ? `Rechentiefe ${depth} · + heißt Vorteil Weiß` : 'Rechne …';
  render();
}

async function analyse(movetime = 6000) {
  const fen = buildFen(state.board, state.turn, castling());
  const problem = positionProblem(fen);
  if (problem) {
    setError($('#error'), problem);
    return;
  }
  const run = ++analysisRun;
  state.mode = 'analysis';
  state.lines = [];
  $('#btn-longer').disabled = true;
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

function backToEdit() {
  analysisRun++;
  engine.stop();
  state.mode = 'edit';
  render();
}

// ---------- wiring ----------

function init() {
  buildPalette();

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
  $('#btn-analyse').addEventListener('click', () => analyse());
  $('#btn-longer').addEventListener('click', () => analyse(20000));
  $('#btn-edit').addEventListener('click', backToEdit);

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
