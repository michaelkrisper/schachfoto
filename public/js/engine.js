const ENGINE_URL = '/vendor/stockfish-19-lite-single.js';

export function parseInfo(line) {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const depth = /\bdepth (\d+)/.exec(line);
  const multipv = /\bmultipv (\d+)/.exec(line);
  const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
  if (!depth || !score) return null;
  return {
    depth: Number(depth[1]),
    multipv: multipv ? Number(multipv[1]) : 1,
    score: { type: score[1], value: Number(score[2]) },
    pv: line
      .slice(line.indexOf(' pv ') + 4)
      .trim()
      .split(/\s+/),
  };
}

// Thin UCI wrapper. One analysis at a time; a new analyse() cancels the previous one.
export class Engine {
  #worker = null;
  #ready = null;
  #onLine = null;
  #searching = false;

  #boot() {
    if (this.#ready) return this.#ready;
    this.#worker = new Worker(ENGINE_URL);
    this.#worker.onmessage = (ev) => this.#onLine?.(String(ev.data));
    this.#ready = this.#send('uci', 'uciok').then(() => this.#send('isready', 'readyok'));
    return this.#ready;
  }

  #send(cmd, until) {
    return new Promise((resolve) => {
      this.#onLine = (line) => {
        if (line.startsWith(until)) resolve();
      };
      this.#worker.postMessage(cmd);
    });
  }

  async analyse(fen, { lines = 3, movetime = 6000, onUpdate }) {
    await this.stop();
    await this.#boot();
    this.#worker.postMessage(`setoption name MultiPV value ${lines}`);
    this.#worker.postMessage('ucinewgame');
    await this.#send('isready', 'readyok');
    const best = [];
    return new Promise((resolve) => {
      this.#onLine = (line) => {
        const info = parseInfo(line);
        if (info) {
          best[info.multipv - 1] = info;
          onUpdate?.(best.filter(Boolean));
        } else if (line.startsWith('bestmove')) {
          this.#searching = false;
          this.#onLine = null;
          resolve(best.filter(Boolean));
        }
      };
      this.#worker.postMessage(`position fen ${fen}`);
      this.#searching = true;
      this.#worker.postMessage(`go movetime ${movetime}`);
    });
  }

  async stop() {
    if (!this.#searching) return;
    const pending = this.#onLine;
    await new Promise((resolve) => {
      this.#onLine = (line) => {
        pending(line);
        if (line.startsWith('bestmove')) resolve();
      };
      this.#worker.postMessage('stop');
    });
  }
}
