import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Engine, parseInfo } from '../public/js/engine.js';

// Minimal stand-in for the Stockfish worker: answers the UCI handshake and
// replays scripted search output for every `go`.
class FakeWorker {
  static instances = [];
  sent = [];
  constructor(url) {
    this.url = url;
    FakeWorker.instances.push(this);
  }
  emit(...lines) {
    for (const line of lines) queueMicrotask(() => this.onmessage({ data: line }));
  }
  postMessage(cmd) {
    this.sent.push(cmd);
    if (cmd === 'uci') this.emit('id name Fake', 'uciok');
    else if (cmd === 'isready') this.emit('readyok');
    else if (cmd.startsWith('go ')) {
      if (FakeWorker.hold) return;
      this.emit(
        'info depth 1 multipv 1 score cp 20 pv e2e4',
        'info depth 1 multipv 2 score cp 10 pv d2d4',
        'info depth 2 multipv 1 score cp 30 pv e2e4 e7e5',
        'bestmove e2e4',
      );
    } else if (cmd === 'stop') this.emit('bestmove e2e4');
  }
}

const realWorker = globalThis.Worker;
globalThis.Worker = FakeWorker;
afterEach(() => {
  FakeWorker.instances = [];
  FakeWorker.hold = false;
});
process.on('exit', () => {
  globalThis.Worker = realWorker;
});

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('parseInfo ignores lines without a principal variation', () => {
  assert.equal(parseInfo('info depth 5 seldepth 7'), null);
  assert.equal(parseInfo('bestmove e2e4'), null);
  assert.deepEqual(parseInfo('info depth 12 score mate -3 pv h7h8q a1a2'), {
    depth: 12,
    multipv: 1,
    score: { type: 'mate', value: -3 },
    pv: ['h7h8q', 'a1a2'],
  });
});

test('analyse runs the UCI handshake once and returns the best lines', async () => {
  const engine = new Engine();
  const updates = [];
  const lines = await engine.analyse(FEN, {
    lines: 2,
    movetime: 100,
    onUpdate: (b) => updates.push(b.length),
  });
  assert.deepEqual(
    lines.map((l) => [l.multipv, l.depth, l.pv[0]]),
    [
      [1, 2, 'e2e4'],
      [2, 1, 'd2d4'],
    ],
  );
  assert.deepEqual(updates, [1, 2, 2]);

  await engine.analyse(FEN, { lines: 2, movetime: 100 });
  assert.equal(FakeWorker.instances.length, 1);
  const sent = FakeWorker.instances[0].sent;
  assert.equal(sent.filter((c) => c === 'uci').length, 1);
  assert.ok(sent.includes('setoption name MultiPV value 2'));
  assert.ok(sent.includes(`position fen ${FEN}`));
  assert.ok(sent.includes('go movetime 100'));
});

test('a new analysis stops the running one first', async () => {
  const engine = new Engine();
  FakeWorker.hold = true;
  const first = engine.analyse(FEN, { movetime: 60000 });
  // Let the handshake finish so the first search is actually running.
  await new Promise((r) => setTimeout(r, 10));
  FakeWorker.hold = false;
  const second = engine.analyse(FEN, { movetime: 100 });
  assert.deepEqual(await first, []);
  assert.equal((await second).length, 2);
  const sent = FakeWorker.instances[0].sent;
  assert.ok(sent.indexOf('stop') < sent.lastIndexOf('go movetime 100'));
});
