/**
 * Smoke test in headless Chrome: builds the start position by hand, lets the
 * engine run and checks that move suggestions appear. Needs `npm run dev`.
 *
 *   node scripts/browser-check.mjs [http://localhost:8793] [screenshot.png]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:8793';
const shot = process.argv[3];
const port = 9334;
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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: base });
  await wait(1500);
  await evaluate(`document.querySelector('#btn-manual').click()`);
  // Move the e2 pawn to e4 by hand: erase e2, place a pawn on e4.
  await evaluate(`(() => {
    const sq = (n) => document.querySelector('#board [aria-label^="' + n + '"]');
    document.querySelector('[data-piece=""]').click();
    sq('e2').click();
    document.querySelector('[data-piece="P"]').click();
    sq('e4').click();
    document.querySelector('[data-turn="b"]').click();
    document.querySelector('#btn-analyse').click();
  })()`);
  await wait(8000);
  const result = await evaluate(`({
    lines: [...document.querySelectorAll('#lines li')].map((li) => li.textContent),
    depth: document.querySelector('#depth').textContent,
    arrows: document.querySelectorAll('#board .arrows g').length,
    error: document.querySelector('#error').textContent,
  })`);
  console.log(JSON.stringify(result, null, 2));
  if (shot) {
    const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(shot, Buffer.from(png.result.data, 'base64'));
  }
  ok = result.lines.length === 3 && result.arrows === 3 && errors.length === 0;
} finally {
  if (errors.length) console.error('page errors:', errors);
  ws.close();
  chrome.kill();
  await wait(300);
  rmSync(profile, { recursive: true, force: true });
}
console.log(ok ? 'OK' : 'FAILED');
process.exit(ok ? 0 : 1);
