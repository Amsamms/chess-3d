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

/** Hard upper bound (ms) before we forcibly stop and warn. Prevents infinite hangs. */
const BESTMOVE_TIMEOUT_MS = 10_000;

export class StockfishEngine {
  private worker: Worker | null = null;
  private msgListeners: Array<(line: string) => void> = [];
  private ready = false;
  /**
   * Incremented every time stop() or dispose() is called.
   * bestMove() captures the generation at entry; if it changes before bestmove
   * arrives, the result is silently discarded (stale search from a previous game).
   */
  private generation = 0;

  async init(): Promise<void> {
    if (this.worker) return;
    // Use BASE_URL so the worker URL gets prefixed (e.g. `/chess-3d/` on GitHub Pages).
    this.worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish.js`);
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

  disableLimitStrength() {
    this.post('setoption name UCI_LimitStrength value false');
  }

  /**
   * Ask the engine for the best move given current FEN + movetime budget.
   * Resolves once `bestmove <uci>` arrives, or null on timeout/stop.
   *
   * multiPV: if > 1, requests N candidate moves and returns one chosen by
   * the caller-supplied selector. The engine still responds with a single
   * bestmove line; the candidates appear in "info ... multipv N score cp ..."
   * lines. We collect them and pass to the selector so the caller can pick
   * randomly among the top moves for opening variety.
   *
   * UCI hygiene matters: skipping the `readyok` wait between commands
   * makes the WASM build trap with "unreachable" after several searches
   * (especially across context switches like piece-set changes that reset
   * the board). So we explicitly wait for `readyok` after `ucinewgame` and
   * after `position fen` before issuing `go`.
   */
  async bestMove(
    fen: string,
    movetimeMs = 1000,
    multiPV = 1,
    selectCandidate?: (candidates: BestMoveResult[]) => BestMoveResult
  ): Promise<BestMoveResult | null> {
    if (!this.worker) throw new Error('Engine not initialized');

    // Belt-and-suspenders: halt any prior search before queuing new commands.
    this.post('stop');
    this.post('ucinewgame');
    await this.send('isready', (line) => line === 'readyok');
    this.post(`position fen ${fen}`);
    await this.send('isready', (line) => line === 'readyok');

    // Snapshot the generation counter. If stop()/dispose() runs while we
    // are awaiting bestmove, the generation will have changed and we discard
    // the stale result rather than deliver it to a new game.
    const capturedGen = this.generation;

    if (multiPV > 1) {
      this.post(`setoption name MultiPV value ${multiPV}`);
    }

    return new Promise<BestMoveResult | null>((resolve) => {
      // Candidate moves collected from "info multipv" lines.
      const candidates: BestMoveResult[] = [];

      const cleanup = this.addListener((line) => {
        // Collect MultiPV info lines: "info depth X multipv N score cp ... pv <move> ..."
        if (multiPV > 1 && line.includes('multipv') && line.includes(' pv ')) {
          const pvMatch = / pv ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(line);
          if (pvMatch) {
            const mvResult = parseUCI(pvMatch[1]);
            // Store by multipv rank (1-based), overwrite on deeper iteration.
            const rankMatch = /multipv (\d+)/.exec(line);
            const rank = rankMatch ? parseInt(rankMatch[1], 10) : candidates.length + 1;
            candidates[rank - 1] = mvResult;
          }
        }

        if (line.startsWith('bestmove')) {
          clearTimeout(timeoutHandle);
          const parts = line.split(/\s+/);
          const uci = parts[1] ?? '(none)';
          cleanup();

          // Reset MultiPV to 1 after use so it does not bleed into the next search.
          if (multiPV > 1) {
            this.post('setoption name MultiPV value 1');
          }

          // Discard stale results from a previous game/stop cycle.
          if (this.generation !== capturedGen) {
            resolve(null);
            return;
          }

          if (uci === '(none)' || !uci) {
            resolve(null);
            return;
          }

          const engineBest = parseUCI(uci);

          // If MultiPV collected candidates and a selector was provided, use it.
          if (multiPV > 1 && candidates.length > 0 && selectCandidate) {
            // Ensure at least the engine's own best is in the list.
            if (!candidates[0]) candidates[0] = engineBest;
            resolve(selectCandidate(candidates.filter(Boolean)));
            return;
          }

          resolve(engineBest);
        }
      });

      // Hard timeout: if bestmove never arrives, stop the search and warn.
      const timeoutHandle = setTimeout(() => {
        console.warn(
          `[StockfishEngine] bestmove timeout after ${BESTMOVE_TIMEOUT_MS}ms, sending stop.`
        );
        this.post('stop');
        cleanup();
        if (multiPV > 1) {
          this.post('setoption name MultiPV value 1');
        }
        resolve(null);
      }, BESTMOVE_TIMEOUT_MS);

      this.post(`go movetime ${movetimeMs}`);
    });
  }

  /** Hard-reset: terminate the worker and clear state. Used between tests / set changes. */
  dispose() {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    }
    this.msgListeners = [];
    this.ready = false;
    this.generation += 1; // invalidate any in-flight bestMove promise
  }

  /** Stop any in-flight search. Does NOT tear down the worker. */
  stop() {
    this.generation += 1; // invalidate any in-flight bestMove promise
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
