import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { onRequestPost } from '../functions/api/recognize.js';

// Workers-only API, used for the access code comparison.
crypto.subtle.timingSafeEqual ??= (a, b) => timingSafeEqual(a, b);

const env = { GEMINI_API_KEY: 'key', ACCESS_CODE: 'secret' };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function request(body = { image: 'aGVsbG8=', mediaType: 'image/jpeg' }, code = 'secret') {
  return new Request('https://x/api/recognize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-access-code': code },
    body: JSON.stringify(body),
  });
}

function geminiAnswer(result) {
  return Response.json({
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ text: 'thinking...', thought: true }, { text: JSON.stringify(result) }] },
      },
    ],
  });
}

const START = {
  board_found: true,
  ranks: ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'],
  uncertain: ['e4', 'zz'],
  note: '',
};

test('rejects a wrong access code', async () => {
  const res = await onRequestPost({ request: request(undefined, 'nope'), env });
  assert.equal(res.status, 401);
});

test('reports a missing API key', async () => {
  const res = await onRequestPost({ request: request(), env: { ACCESS_CODE: 'secret' } });
  assert.equal(res.status, 503);
});

test('rejects non-image uploads', async () => {
  const res = await onRequestPost({ request: request({ image: 'x', mediaType: 'text/html' }), env });
  assert.equal(res.status, 400);
});

test('returns the recognised placement and drops invalid squares', async () => {
  globalThis.fetch = async () => geminiAnswer(START);
  const res = await onRequestPost({ request: request(), env });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    placement: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
    uncertain: ['e4'],
    note: '',
  });
});

test('turns a board that was read from black side', async () => {
  const ranks = [
    'RNBKQBNR',
    'PPP.PPPP',
    '........',
    '...P....',
    '........',
    '........',
    'pppppppp',
    'rnbkqbnr',
  ];
  globalThis.fetch = async () => geminiAnswer({ ...START, ranks });
  const body = await (await onRequestPost({ request: request(), env })).json();
  assert.equal(body.placement, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
});

test('falls through to the next model when one is overloaded', async () => {
  const models = [];
  globalThis.fetch = async (url) => {
    models.push(String(url).match(/models\/([^:]+)/)[1]);
    return models.length === 1 ? new Response('busy', { status: 503 }) : geminiAnswer(START);
  };
  const res = await onRequestPost({ request: request(), env });
  assert.equal(res.status, 200);
  assert.equal(models.length, 2);
  assert.notEqual(models[0], models[1]);
});

test('reports exhausted quota when every model is rate-limited', async () => {
  globalThis.fetch = async () => new Response('quota', { status: 429 });
  const res = await onRequestPost({ request: request(), env });
  assert.equal(res.status, 429);
});

test('reports a photo without a board', async () => {
  globalThis.fetch = async () =>
    geminiAnswer({ board_found: false, ranks: [], uncertain: [], note: 'Nur ein Tisch.' });
  const res = await onRequestPost({ request: request(), env });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error, 'Nur ein Tisch.');
});

test('rejects malformed ranks from the model', async () => {
  globalThis.fetch = async () => geminiAnswer({ ...START, ranks: ['rnbqkbnr'] });
  const res = await onRequestPost({ request: request(), env });
  assert.equal(res.status, 502);
});
