/**
 * Smoke test in headless Chrome on a phone-sized viewport: builds a position by
 * hand, lets the engine run, then plays moves via suggestion, drag & drop and
 * tap-tap, undoes one and passes. Also checks that the page never scrolls.
 * Needs `npm run dev` (or pass a deployed URL).
 *
 *   node scripts/browser-check.mjs [http://localhost:8793] [screenshot.png]
 *   VIEWPORT=375x667 node scripts/browser-check.mjs   # e.g. iPhone SE
 *
 * With a screenshot path, the edit view is saved as well (suffix -edit).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:8793';
const shot = process.argv[3];
const port = 9334;
const [width, height] = (process.env.VIEWPORT ?? '390x844').split('x').map(Number);
const profile = mkdtempSync(join(tmpdir(), 'sf-chrome-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  'google-chrome',
  ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
);

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      return (await res.json()).webSocketDebuggerUrl;
    } catch {
      await wait(100);
    }
  }
  throw new Error('chrome did not start');
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  pending.get(msg.id)?.(msg);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

let ok = false;
try {
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: base });
  await wait(1500);
  await evaluate(`localStorage.clear()`);
  await evaluate(`document.querySelector('#btn-manual').click()`);
  // Move the e2 pawn to e4 by hand: erase e2, place a pawn on e4.
  await evaluate(`(() => {
    const sq = (n) => document.querySelector('#board [aria-label^="' + n + '"]');
    document.querySelector('[data-piece=""]').click();
    sq('e2').click();
    document.querySelector('[data-piece="P"]').click();
    sq('e4').click();
    document.querySelector('[data-turn="b"]').click();
  })()`);
  const editScrolls = await evaluate(
    `document.documentElement.scrollHeight > innerHeight || document.body.scrollHeight > innerHeight`,
  );
  if (shot) {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shot.replace(/\.png$/, '-edit.png'), Buffer.from(png.result.data, 'base64'));
  }
  await evaluate(`document.querySelector('#btn-analyse').click()`);
  await wait(7000);
  const state = () =>
    evaluate(`({
      lines: document.querySelectorAll('#lines .line').length,
      arrows: document.querySelectorAll('#board .arrows g').length,
      status: document.querySelector('#status').textContent,
      moves: document.querySelector('#moves').textContent,
      scrolls: document.documentElement.scrollHeight > innerHeight || document.body.scrollHeight > innerHeight,
    })`);
  const center = (sq) =>
    evaluate(`(() => {
      const r = document.querySelector('#board [aria-label^="${sq}"]').getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`);
  const mouse = (type, [x, y]) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1 });
  const drag = async (from, to) => {
    const a = await center(from);
    const b = await center(to);
    await mouse('mousePressed', a);
    for (let i = 1; i <= 5; i++) await mouse('mouseMoved', [a[0] + ((b[0] - a[0]) * i) / 5, a[1] + ((b[1] - a[1]) * i) / 5]);
    await mouse('mouseReleased', b);
  };
  const tap = async (sq) => {
    const p = await center(sq);
    await mouse('mousePressed', p);
    await mouse('mouseReleased', p);
  };

  const steps = {};
  steps.analysed = await state();
  await evaluate(`document.querySelector('#lines .line').click()`);
  await wait(300);
  steps.suggestion = await state();
  await drag('g1', 'f3');
  await wait(300);
  steps.drag = await state();
  await tap('b8');
  await tap('c6');
  await wait(300);
  steps.tap = await state();
  await evaluate(`document.querySelector('#btn-undo').click()`);
  await wait(300);
  steps.undo = await state();
  await evaluate(`document.querySelector('#btn-pass').click()`);
  await wait(4000);
  steps.pass = await state();
  console.log(JSON.stringify(steps, null, 2));
  if (shot) {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shot, Buffer.from(png.result.data, 'base64'));
  }
  const all = Object.values(steps);
  ok =
    steps.analysed.lines === 3 &&
    steps.analysed.arrows === 3 &&
    steps.suggestion.status.startsWith('Weiß') &&
    steps.drag.moves.includes('Sf3') &&
    steps.tap.moves.includes('Sc6') &&
    !steps.undo.moves.includes('Sc6') &&
    steps.pass.status.startsWith('Weiß') &&
    steps.pass.lines === 3 &&
    !editScrolls &&
    all.every((st) => !st.scrolls) &&
    errors.length === 0;
} finally {
  if (errors.length) console.error('page errors:', errors);
  ws.close();
  chrome.kill();
  await wait(300);
  rmSync(profile, { recursive: true, force: true });
}
console.log(ok ? 'OK' : 'FAILED');
process.exit(ok ? 0 : 1);
