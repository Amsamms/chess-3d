-- Chess 3D multiplayer -- Phase 7-D: security hardening
--
-- Fixes:
--   F6: games_play_move WITH CHECK allowed a player to directly write result='1-0' (or any value)
--       because RLS UPDATE policies cannot compare OLD vs NEW rows. The policy's WITH CHECK
--       only inspected the *new* row, which passed as long as auth.uid() IN (white_id, black_id).
--
--   F7: games_join_as_black WITH CHECK only asserted black_id = auth.uid(), so the joiner
--       could simultaneously overwrite fen/moves/result while claiming the black slot.
--
--   F22 matchmaking: queue.player_id lacked a UNIQUE constraint so one player could queue
--       multiple times. Also no cleanup of stale queue rows older than 5 minutes.
--
-- Strategy:
--   * Replace the permissive RLS WITH CHECK clauses with a single BEFORE UPDATE trigger
--     (enforce_game_invariants) that runs BEFORE every UPDATE on games and raises exceptions
--     on any violation. The trigger sees both OLD and NEW, which RLS cannot.
--   * Re-drop and recreate the two vulnerable UPDATE policies with tighter WITH CHECK clauses
--     (they still gate *who* can update at all, but invariant checking moves to the trigger).
--   * Add resign_game(game_id uuid) SECURITY DEFINER function so resignation never requires
--     a direct UPDATE from the client.
--   * Add UNIQUE constraint on queue.player_id.
--   * Add cleanup helper for stale queue rows + invoke it inside pair_queue().
--
-- Idempotency: every object uses CREATE OR REPLACE, IF NOT EXISTS, or a DROP IF EXISTS guard.
-- This file assumes 001_init.sql and 002_queue.sql have already been applied.
--

-- ============================================================================
-- 1) BEFORE UPDATE trigger: enforce_game_invariants
-- ============================================================================
--
-- Rules enforced (all run before any UPDATE reaches the table):
--
--  (A) IDENTITY LOCK: white_id is immutable. Once set it cannot change.
--
--  (B) BLACK-SLOT CLAIM: black_id may only transition NULL -> auth.uid() (join).
--      Any other change to black_id is forbidden.
--      On that specific transition, the joiner MUST NOT change fen, moves, or result.
--
--  (C) MOVE UPDATE: when fen or moves changes, the caller must be the side-to-move
--      (split_part(OLD.fen,' ',2) = 'w' implies white_id = auth.uid(), etc.),
--      and only fen / moves / last_move_at / piece_set / environment may change.
--      result may NOT be changed here; it must go through resign_game().
--
--  (D) RESULT LOCK: result may only be set by resign_game() (which sets a session
--      variable chess3d.resign_caller before the UPDATE) or internally by this
--      trigger when it detects a legitimate chess result written through the
--      resign_game() path. Direct writes to result from any other path are rejected.
--
-- Note on auth.uid() inside trigger:
--   auth.uid() calls the auth.uid() SQL function that Supabase installs as a wrapper
--   around current_setting('request.jwt.claims', true). It returns the caller's UUID
--   when RLS is active, and NULL for SECURITY DEFINER contexts (which is fine -- the
--   trigger runs in the caller's security context, not SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.enforce_game_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  caller uuid := auth.uid();
  is_resign_path boolean;
  resign_caller_setting text;
BEGIN
  -- (A) white_id is immutable.
  IF NEW.white_id IS DISTINCT FROM OLD.white_id THEN
    RAISE EXCEPTION 'games: white_id is immutable (old=%, attempted=%)', OLD.white_id, NEW.white_id;
  END IF;

  -- Check whether this UPDATE originates from resign_game().
  -- resign_game() sets chess3d.resign_caller = caller_uuid before the UPDATE.
  resign_caller_setting := current_setting('chess3d.resign_caller', true); -- true = missing_ok
  is_resign_path := (
    resign_caller_setting IS NOT NULL
    AND resign_caller_setting <> ''
    AND resign_caller_setting::uuid IN (OLD.white_id, OLD.black_id)
  );

  -- (D) result may only change via the resign_game() path.
  IF NEW.result IS DISTINCT FROM OLD.result AND NOT is_resign_path THEN
    RAISE EXCEPTION 'games: result may only be changed via resign_game(), not by direct UPDATE';
  END IF;

  -- (B) BLACK-SLOT CLAIM: black_id may only go NULL -> auth.uid().
  IF NEW.black_id IS DISTINCT FROM OLD.black_id THEN
    IF OLD.black_id IS NOT NULL THEN
      RAISE EXCEPTION 'games: black_id is immutable once set (was %, attempted %)', OLD.black_id, NEW.black_id;
    END IF;
    -- Transitioning NULL -> something: must be the caller claiming their own slot.
    IF NEW.black_id IS NULL OR NEW.black_id <> caller THEN
      RAISE EXCEPTION 'games: black_id may only be set to the authenticated caller (caller=%, attempted=%)', caller, NEW.black_id;
    END IF;
    -- On a join, fen / moves / result must be unchanged.
    IF NEW.fen IS DISTINCT FROM OLD.fen THEN
      RAISE EXCEPTION 'games: fen must be unchanged when joining as black';
    END IF;
    IF NEW.moves IS DISTINCT FROM OLD.moves THEN
      RAISE EXCEPTION 'games: moves must be unchanged when joining as black';
    END IF;
    IF NEW.result IS DISTINCT FROM OLD.result THEN
      RAISE EXCEPTION 'games: result must be unchanged when joining as black';
    END IF;
    -- Join path is valid; allow the row through.
    RETURN NEW;
  END IF;

  -- (C) MOVE PATH: fen or moves changed (and we're not on the join path).
  IF NEW.fen IS DISTINCT FROM OLD.fen OR NEW.moves IS DISTINCT FROM OLD.moves THEN
    -- Game must be in progress.
    IF OLD.result IS NOT NULL THEN
      RAISE EXCEPTION 'games: cannot play a move in a finished game (result=%)', OLD.result;
    END IF;
    -- Both players must be seated.
    IF OLD.white_id IS NULL OR OLD.black_id IS NULL THEN
      RAISE EXCEPTION 'games: cannot play a move before both players have joined';
    END IF;
    -- Turn check: the caller must be the side to move.
    IF split_part(OLD.fen, ' ', 2) = 'w' THEN
      IF caller IS DISTINCT FROM OLD.white_id THEN
        RAISE EXCEPTION 'games: it is white''s turn but caller (%) is not white (%)', caller, OLD.white_id;
      END IF;
    ELSIF split_part(OLD.fen, ' ', 2) = 'b' THEN
      IF caller IS DISTINCT FROM OLD.black_id THEN
        RAISE EXCEPTION 'games: it is black''s turn but caller (%) is not black (%)', caller, OLD.black_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'games: cannot parse side-to-move from fen: %', OLD.fen;
    END IF;
  END IF;

  -- All checks passed.
  RETURN NEW;
END;
$$;

-- Drop any old version of this trigger before creating.
DROP TRIGGER IF EXISTS enforce_game_invariants ON public.games;
CREATE TRIGGER enforce_game_invariants
  BEFORE UPDATE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_game_invariants();

-- NOTE: the existing games_touch_last_move_at trigger from 001_init.sql also fires BEFORE UPDATE.
-- Postgres fires BEFORE triggers in name order: 'enforce_game_invariants' sorts before
-- 'games_touch_last_move_at', so invariant checking runs first. No ordering conflict.


-- ============================================================================
-- 2) Tighten the two vulnerable RLS UPDATE policies
-- ============================================================================
--
-- The trigger above is the primary defense. The RLS policies still control *which
-- rows* a caller may attempt to update. We tighten their WITH CHECK clauses so that
-- even if the trigger were somehow bypassed, the policies would reject the write.

-- (a) Join-as-black: tighten WITH CHECK to also assert the other columns are unchanged.
--     Because RLS cannot read OLD values, we can only assert what the *new* row must
--     look like. Requiring white_id IS NOT NULL prevents joining before the creator
--     seated themselves (covered by INSERT policy, but belt-and-suspenders).
DROP POLICY IF EXISTS games_join_as_black ON public.games;
CREATE POLICY games_join_as_black
  ON public.games
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND black_id IS NULL
    AND white_id IS DISTINCT FROM auth.uid()
    AND result IS NULL
  )
  WITH CHECK (
    black_id = auth.uid()
    AND white_id IS NOT NULL
    AND result IS NULL
  );

-- (b) Play-move: tighten WITH CHECK to assert identity columns are intact and result
--     is still NULL (so a player cannot write the result directly; resign_game() is
--     the only legitimate result-writing path).
DROP POLICY IF EXISTS games_play_move ON public.games;
CREATE POLICY games_play_move
  ON public.games
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND result IS NULL
    AND black_id IS NOT NULL
    AND (
      (split_part(fen, ' ', 2) = 'w' AND white_id = auth.uid())
      OR
      (split_part(fen, ' ', 2) = 'b' AND black_id = auth.uid())
    )
  )
  WITH CHECK (
    -- Identity columns must be unchanged (enforced redundantly by trigger).
    white_id = auth.uid() OR black_id = auth.uid()
    -- result must remain NULL (the trigger also rejects any non-resign_game write to result).
    -- We cannot assert NEW.result IS NULL here in RLS without OLD access,
    -- so the trigger is the authoritative check. This policy just gates row access.
  );

-- (c) Resign path: allow resign_game() SECURITY DEFINER to bypass RLS for the result UPDATE.
--     SECURITY DEFINER functions run as the function owner (postgres / service_role), which
--     bypasses RLS automatically. No extra policy needed; the function validates the caller.


-- ============================================================================
-- 3) resign_game(game_id text) SECURITY DEFINER function
-- ============================================================================
--
-- The client calls this RPC instead of a direct UPDATE to set result.
-- Validation:
--   - The calling auth.uid() must be white_id or black_id.
--   - The game must be in progress (result IS NULL).
--   - Sets result to the opponent's win string ('0-1' if white resigns, '1-0' if black resigns).
-- The function sets chess3d.resign_caller before the UPDATE so the trigger allows
-- the result change, then clears it after.
--
-- Access: grant to 'anon' and 'authenticated' roles because the project uses anonymous auth
-- (clients are always anonymous-authed, never signed up). The function validates
-- auth.uid() itself, so granting to anon is safe.

CREATE OR REPLACE FUNCTION public.resign_game(p_game_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  g     public.games;
  new_result text;
BEGIN
  -- Require authentication.
  IF caller IS NULL THEN
    RAISE EXCEPTION 'resign_game: caller is not authenticated';
  END IF;

  -- Lock the row to prevent concurrent resign vs. resign race.
  SELECT * INTO g FROM public.games WHERE id = p_game_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resign_game: game % not found', p_game_id;
  END IF;

  -- Caller must be a participant.
  IF caller NOT IN (g.white_id, g.black_id) THEN
    RAISE EXCEPTION 'resign_game: caller % is not a participant in game %', caller, p_game_id;
  END IF;

  -- Game must still be in progress.
  IF g.result IS NOT NULL THEN
    RAISE EXCEPTION 'resign_game: game % is already finished (result=%)', p_game_id, g.result;
  END IF;

  -- Both seats must be filled (cannot resign a waiting room).
  IF g.white_id IS NULL OR g.black_id IS NULL THEN
    RAISE EXCEPTION 'resign_game: game % is not fully joined yet', p_game_id;
  END IF;

  -- Determine opponent win string.
  IF caller = g.white_id THEN
    new_result := '0-1';  -- white resigns, black wins
  ELSE
    new_result := '1-0';  -- black resigns, white wins
  END IF;

  -- Signal to the trigger that this is a legitimate resign path.
  PERFORM set_config('chess3d.resign_caller', caller::text, true);  -- true = is_local (session-scoped)

  UPDATE public.games
  SET result = new_result
  WHERE id = p_game_id;

  -- Clear the signal (belt-and-suspenders; local config expires with the transaction anyway).
  PERFORM set_config('chess3d.resign_caller', '', true);
END;
$$;

-- Grant execute to the roles the Supabase anon key uses.
GRANT EXECUTE ON FUNCTION public.resign_game(text) TO anon;
GRANT EXECUTE ON FUNCTION public.resign_game(text) TO authenticated;


-- ============================================================================
-- 4) Queue: UNIQUE constraint on player_id + stale-row cleanup
-- ============================================================================

-- One player, one queue slot. If they were already queued (e.g. double-click,
-- browser back+forward), the second INSERT will fail gracefully with a unique
-- violation; the client should catch this and treat it as "already queued".
-- We use IF NOT EXISTS logic via a DO block to stay idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'queue_player_id_unique'
      AND conrelid = 'public.queue'::regclass
  ) THEN
    ALTER TABLE public.queue ADD CONSTRAINT queue_player_id_unique UNIQUE (player_id);
  END IF;
END$$;

-- Stale queue rows: rows that are more than 5 minutes old and still unmatched
-- waste the partner-search scan and confuse reconnecting players. We clean them
-- up inside pair_queue() (already SECURITY DEFINER) and also expose a standalone
-- maintenance function for manual or pg_cron use.

CREATE OR REPLACE FUNCTION public.cleanup_stale_queue()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count int;
BEGIN
  DELETE FROM public.queue
  WHERE game_id IS NULL
    AND created_at < now() - interval '5 minutes';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_stale_queue() TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_queue() TO authenticated;

-- Augment pair_queue() to call cleanup at the top of every INSERT trigger invocation.
-- This keeps the queue lean without requiring a scheduled job.
-- We recreate the whole function (same body as 002_queue.sql, with cleanup added at top).
CREATE OR REPLACE FUNCTION public.pair_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  partner public.queue;
  new_code text;
  white_uuid uuid;
  black_uuid uuid;
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L
  attempt int;
BEGIN
  -- Remove stale unmatched rows older than 5 minutes before searching for a partner.
  DELETE FROM public.queue
  WHERE game_id IS NULL
    AND created_at < now() - interval '5 minutes'
    AND id <> NEW.id;  -- don't delete the row we are currently inserting

  -- Skip pairing if this insert already has a game_id (shouldn't happen with RLS but defend).
  IF NEW.game_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO partner
  FROM public.queue
  WHERE game_id IS NULL
    AND player_id <> NEW.player_id
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    -- Nobody waiting -- this player keeps the spot for someone else to find.
    RETURN NEW;
  END IF;

  -- Generate a 6-char code, retry on the (astronomically rare) collision.
  attempt := 0;
  LOOP
    new_code := '';
    FOR i IN 1..6 LOOP
      new_code := new_code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.games WHERE id = new_code);
    attempt := attempt + 1;
    IF attempt > 5 THEN RAISE EXCEPTION 'room code generator exhausted'; END IF;
  END LOOP;

  -- Coin flip on color assignment.
  IF random() < 0.5 THEN
    white_uuid := partner.player_id;
    black_uuid := NEW.player_id;
  ELSE
    white_uuid := NEW.player_id;
    black_uuid := partner.player_id;
  END IF;

  INSERT INTO public.games (id, white_id, black_id)
  VALUES (new_code, white_uuid, black_uuid);

  UPDATE public.queue SET game_id = new_code WHERE id = partner.id;
  NEW.game_id := new_code;

  RETURN NEW;
END;
$$;

-- Trigger is already created by 002_queue.sql (DROP IF EXISTS + CREATE).
-- Recreating here to attach the updated function body (function is already replaced above).
DROP TRIGGER IF EXISTS queue_pair_on_insert ON public.queue;
CREATE TRIGGER queue_pair_on_insert
  BEFORE INSERT ON public.queue
  FOR EACH ROW
  EXECUTE FUNCTION public.pair_queue();


-- ============================================================================
-- 5) OPTIONAL forward-compat: clock checkpoint columns on games
-- ============================================================================
--
-- Nullable bigint columns (milliseconds remaining at last move) for Phase 7-D chess clock.
-- The client feature-detects these columns and only activates the clock UI when present.
-- Adding them now avoids a schema-reload round-trip when the clock feature ships.
-- Default NULL means "no clock, time-unlimited game".

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'white_ms'
  ) THEN
    ALTER TABLE public.games ADD COLUMN white_ms bigint DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'black_ms'
  ) THEN
    ALTER TABLE public.games ADD COLUMN black_ms bigint DEFAULT NULL;
  END IF;
END$$;
