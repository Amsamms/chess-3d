/**
 * Wraps the Stockfish WASM as a Web Worker and exposes a small async UCI API.
 * The worker script is served from /stockfish/stockfish.js (copied from npm at build time).
 */

export interface BestMoveResult {
  from: string;
  to: string;
  promotion?: string;
  ponderMove?: string;
}

export class StockfishEngine {
  private worker: Worker | null = null;
  private msgListeners: Array<(line: string) => void> = [];
  private ready = false;

  async init(): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker('/stockfish/stockfish.js');
    this.worker.onmessage = (e: MessageEvent<string>) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      // Fan out to listeners
      for (const l of this.msgListeners) l(line);
    };
    this.worker.onerror = (e) => console.error('Stockfish worker error:', e);

    await this.send('uci', (line) => line === 'uciok');
    await this.send('isready', (line) => line === 'readyok');
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  setSkill(level: number) {
    const clamped = Math.max(0, Math.min(20, Math.round(level)));
    this.post(`setoption name Skill Level value ${clamped}`);
  }

  setELO(elo: number) {
    // Lock-in UCI_LimitStrength mode and target a specific ELO.
    this.post('setoption name UCI_LimitStrength value true');
    this.post(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, elo))}`);
  }

  /**
   * Ask the engine for the best move given current FEN + movetime budget.
   * Resolves once `bestmove <uci>` arrives.
   */
  async bestMove(fen: string, movetimeMs = 1000): Promise<BestMoveResult | null> {
    if (!this.worker) throw new Error('Engine not initialized');
    this.post('ucinewgame');
    this.post(`position fen ${fen}`);
    this.post('isready');
    return new Promise((resolve) => {
      const cleanup = this.addListener((line) => {
        if (line.startsWith('bestmove')) {
          // bestmove e2e4 ponder e7e5
          const parts = line.split(/\s+/);
          const uci = parts[1] ?? '(none)';
          cleanup();
          if (uci === '(none)' || !uci) return resolve(null);
          resolve(parseUCI(uci));
        }
      });
      this.post(`go movetime ${movetimeMs}`);
    });
  }

  /** Stop any in-flight search. */
  stop() {
    this.post('stop');
  }

  // ---- internals ----
  private post(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  /** Returns a cleanup function that removes the listener. */
  private addListener(fn: (line: string) => void): () => void {
    this.msgListeners.push(fn);
    return () => {
      const i = this.msgListeners.indexOf(fn);
      if (i >= 0) this.msgListeners.splice(i, 1);
    };
  }

  /** Send a UCI command and resolve when `match` predicate sees its terminator. */
  private send(cmd: string, match: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const cleanup = this.addListener((line) => {
        if (match(line)) {
          cleanup();
          resolve();
        }
      });
      this.post(cmd);
    });
  }
}

function parseUCI(uci: string): BestMoveResult {
  // Format: e2e4, or e7e8q for promotion
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
  return { from, to, promotion };
}
