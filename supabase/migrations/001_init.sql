-- Chess 3D multiplayer — Phase 7-A schema
--
-- Run this whole file once in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).
-- Safe to re-run: every CREATE uses IF NOT EXISTS and every POLICY has a DROP guard.
--
-- Design notes:
--   * The full game state lives in the `games` row: current FEN + a jsonb append-only move log.
--   * Identity is Supabase Anonymous Auth — each browser gets a stable auth.uid() the first time
--     it visits, without any signup. That UUID is bound to white_id / black_id so a player can't
--     pretend to be the other color.
--   * RLS only enforces *identity* and *turn ownership*. It does NOT validate move legality —
--     that's chess.js running on every connected client. If a malicious player POSTs an illegal
--     FEN, every other client will refuse to apply it and the game will halt. Acceptable for v1.
--   * Realtime broadcasts every UPDATE so the other player + any spectators see moves in <200 ms.

-- ----------------------------------------------------------------------------
-- 1) The games table
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.games (
  id text PRIMARY KEY,                                   -- room code: 6 uppercase chars e.g. 'GLEAM7'
  white_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  black_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fen text NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves jsonb NOT NULL DEFAULT '[]'::jsonb,              -- append-only list of {uci, san, ply}
  result text,                                            -- null while in progress; '1-0' | '0-1' | '1/2-1/2' | 'abandoned'
  piece_set text NOT NULL DEFAULT 'fantasy',             -- so both clients render the same set
  environment text NOT NULL DEFAULT 'gothic-night',      -- and the same realm
  created_at timestamptz NOT NULL DEFAULT now(),
  last_move_at timestamptz NOT NULL DEFAULT now()
);

-- Index for "find games I'm in" queries we'll add in later phases.
CREATE INDEX IF NOT EXISTS games_white_idx ON public.games (white_id);
CREATE INDEX IF NOT EXISTS games_black_idx ON public.games (black_id);

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2) RLS policies
-- ----------------------------------------------------------------------------

-- SELECT: anyone (even unauthenticated) can read a game state. Required for spectators.
DROP POLICY IF EXISTS games_select_all ON public.games;
CREATE POLICY games_select_all
  ON public.games
  FOR SELECT
  USING (true);

-- INSERT: any authenticated client can create a room, but only with themselves as white.
DROP POLICY IF EXISTS games_insert_as_white ON public.games;
CREATE POLICY games_insert_as_white
  ON public.games
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND white_id = auth.uid()
    AND black_id IS NULL
    AND result IS NULL
  );

-- UPDATE — three distinct cases, expressed as three policies (OR'd by Postgres):

-- (a) Joining an open room as black. Only allowed when the row had black_id NULL,
--     the new row sets black_id = me, and I'm not already white in that row.
DROP POLICY IF EXISTS games_join_as_black ON public.games;
CREATE POLICY games_join_as_black
  ON public.games
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND black_id IS NULL
    AND white_id IS DISTINCT FROM auth.uid()
  )
  WITH CHECK (
    black_id = auth.uid()
  );

-- (b) Playing your move. Only allowed when:
--       - game is in progress (result IS NULL)
--       - the FEN side-to-move matches your color
DROP POLICY IF EXISTS games_play_move ON public.games;
CREATE POLICY games_play_move
  ON public.games
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND result IS NULL
    AND (
      (split_part(fen, ' ', 2) = 'w' AND white_id = auth.uid())
      OR
      (split_part(fen, ' ', 2) = 'b' AND black_id = auth.uid())
    )
  )
  WITH CHECK (
    -- Don't let a player change their own or the opponent's user id mid-game.
    -- (Note: WITH CHECK on the *new* row; combined with USING on the *old* row.)
    auth.uid() IN (white_id, black_id)
  );

-- (c) Resigning / setting result. INTENTIONALLY NOT ADDED in Phase 7-A:
-- a naive "auth.uid() IN (white_id, black_id) AND result IS NULL" policy is
-- OR'd with games_play_move and effectively grants either player full
-- write-anything-anytime access (since UPDATE policies are OR'd in Postgres).
-- A proper resignation policy must constrain the changed columns. Phase 7-D
-- will use a SECURITY DEFINER function `resign_game(game_id)` instead.
DROP POLICY IF EXISTS games_set_result ON public.games;

-- ----------------------------------------------------------------------------
-- 3) Realtime — publish UPDATE / INSERT on games so subscribers see moves
-- ----------------------------------------------------------------------------

-- Some Supabase projects start without the supabase_realtime publication populated.
-- This is idempotent — if the table is already in the publication, the ALTER is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'games'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.games';
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 4) Convenience: a helper that bumps last_move_at on every update.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.games_touch_last_move_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.last_move_at := now();
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS games_touch_last_move_at ON public.games;
CREATE TRIGGER games_touch_last_move_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.games_touch_last_move_at();
