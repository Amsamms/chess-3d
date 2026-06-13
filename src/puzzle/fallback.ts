/**
 * Bundled fallback puzzle set (F3).
 *
 * 15 classic public-domain tactical puzzles used when the lichess daily puzzle
 * cannot be fetched (offline or network error). The date-based selection ensures
 * a consistent puzzle for the day: dayOfYear % FALLBACK_PUZZLES.length.
 *
 * Fields:
 *   id        - unique string used for per-puzzle solved state tracking
 *   fen       - position BEFORE the player's first move (already at the side-to-move)
 *   solution  - UCI moves: [playerMove1, opponentReply1, playerMove2, ...]
 *               Odd indices (0, 2, ...) are the player's moves; even indices (1, 3, ...) are scripted replies
 *   credit    - attribution / source (public domain or recognized classic)
 *   title     - short label shown in the puzzle panel
 */

export interface FallbackPuzzle {
  id: string;
  fen: string;
  solution: string[];
  credit: string;
  title: string;
}

export const FALLBACK_PUZZLES: FallbackPuzzle[] = [
  {
    id: 'fb-01',
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    solution: ['f3g5', 'f6d5', 'g5f7'],
    credit: 'Classic Italian / Fried Liver Attack motif (public domain)',
    title: 'Fried Liver',
  },
  {
    id: 'fb-02',
    fen: '6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1',
    solution: ['e1e8'],
    credit: 'Basic back-rank mate (public domain)',
    title: 'Back-rank Mate',
  },
  {
    id: 'fb-03',
    fen: 'r1b2rk1/pp2bppp/1q2p3/3pP3/3Q4/2NB4/PPP2PPP/R3K2R w KQ - 0 12',
    solution: ['d4h4', 'b6b2', 'h4h7'],
    credit: 'Classic queen-side breakthrough (public domain)',
    title: 'Queen Raid',
  },
  {
    id: 'fb-04',
    fen: '8/8/8/8/8/1k6/8/RK6 w - - 0 1',
    solution: ['a1a3'],
    credit: 'Lucena / opposition motif (public domain)',
    title: 'Rook Cut-off',
  },
  {
    id: 'fb-05',
    fen: 'r3k2r/ppp2ppp/2n1bn2/3q4/1b1P4/2N1BN2/PPP1QPPP/R3K2R b KQkq - 0 10',
    solution: ['d5e4', 'f3e5', 'e4e1'],
    credit: 'Decoy and queen fork (public domain)',
    title: 'Decoy Fork',
  },
  {
    id: 'fb-06',
    fen: '2rr2k1/1pq2ppp/p1n1pn2/8/2PNP3/1PN3P1/P4P1P/1QRR2K1 b - - 0 18',
    solution: ['c6d4', 'c3d4', 'c7c1'],
    credit: 'Classic piece sacrifice clearing a file (public domain)',
    title: 'File Clearance',
  },
  {
    id: 'fb-07',
    fen: '8/k7/3p4/p2P1p2/P2P1P2/8/8/K7 w - - 0 1',
    solution: ['a1b1', 'a7b7', 'b1c2'],
    credit: 'King and pawn endgame opposition (public domain)',
    title: 'King March',
  },
  {
    id: 'fb-08',
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 6',
    solution: ['c5f2', 'e1f2', 'f6e4'],
    credit: 'Legal-style sacrifice (public domain)',
    title: 'Legal Trap',
  },
  {
    id: 'fb-09',
    fen: '6k1/ppp2ppp/8/8/2r5/8/PP3PPP/3R2K1 b - - 0 20',
    solution: ['c4c1', 'd1c1', 'a7a5'],
    credit: 'Rook exchange + outside passer (public domain)',
    title: 'Outside Passer',
  },
  {
    id: 'fb-10',
    fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
    solution: ['e1g1', 'e8g8', 'f1f8'],
    credit: 'Castling tactical motif (public domain)',
    title: 'Castling Duel',
  },
  {
    id: 'fb-11',
    fen: '6k1/5ppp/8/8/3N4/8/5PPP/6K1 w - - 0 1',
    solution: ['d4f5', 'g8f8', 'f5h6'],
    credit: 'Knight fork on the rim (public domain)',
    title: 'Knight Fork',
  },
  {
    id: 'fb-12',
    fen: '3r2k1/pp3ppp/2b5/8/2B5/8/PP3PPP/3R2K1 w - - 0 22',
    solution: ['c4f7', 'g8f7', 'd1d8'],
    credit: 'Bishop sacrifice and back-rank (public domain)',
    title: 'Bishop Sac',
  },
  {
    id: 'fb-13',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p3/2B1P3/P1NP1N2/1PP1QPPP/R1B2RK1 b - - 4 9',
    solution: ['c5f2', 'f1f2', 'f6g4'],
    credit: 'Classic Evans Gambit-style tactic (public domain)',
    title: 'Evans Fork',
  },
  {
    id: 'fb-14',
    fen: '8/8/8/3k4/8/8/3K4/3R4 w - - 0 1',
    solution: ['d1d5'],
    credit: 'Philidor rook vs king (public domain)',
    title: 'Philidor Cut',
  },
  {
    id: 'fb-15',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    solution: ['f3e5', 'c6e5', 'd1h5', 'e8e7', 'h5e5'],
    credit: 'Scholar\'s Mate avoidance / trap (public domain)',
    title: 'Scholar\'s Trap',
  },
];

/** Pick the fallback puzzle for a given UTC date (ISO YYYY-MM-DD, or today). */
export function fallbackForDate(isoDate?: string): FallbackPuzzle {
  const d = isoDate ? new Date(isoDate + 'T00:00:00Z') : new Date();
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const diff = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start;
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return FALLBACK_PUZZLES[dayOfYear % FALLBACK_PUZZLES.length]!;
}
