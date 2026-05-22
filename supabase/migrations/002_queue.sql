-- Chess 3D multiplayer — Phase 7-C: matchmaking queue
--
-- One row per player waiting for a stranger. On INSERT, a SECURITY DEFINER
-- trigger atomically finds the oldest other waiting player, creates a new
-- games row with random color assignment, and writes the game_id back into
-- both rows. The two clients each subscribe to UPDATE on their own queue
-- row and pivot to the game when game_id materializes.
--
-- Atomicity: the partner SELECT uses FOR UPDATE SKIP LOCKED so two
-- simultaneous inserts can't both pair with the same partner.

CREATE TABLE IF NOT EXISTS public.queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id text REFERENCES public.games(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for the partner-finding query: cheapest path is FK on player_id + ORDER BY created_at
CREATE INDEX IF NOT EXISTS queue_open_idx ON public.queue (created_at) WHERE game_id IS NULL;
CREATE INDEX IF NOT EXISTS queue_player_idx ON public.queue (player_id);

ALTER TABLE public.queue ENABLE ROW LEVEL SECURITY;

-- A player can only see / insert / delete their own queue row.
-- They CANNOT update — pairing UPDATEs are done by the SECURITY DEFINER trigger.
DROP POLICY IF EXISTS queue_select_own ON public.queue;
CREATE POLICY queue_select_own ON public.queue
  FOR SELECT USING (player_id = auth.uid());

-- Note: WITH CHECK runs AFTER any BEFORE INSERT trigger, so we cannot enforce
-- `game_id IS NULL` here — the pair_queue trigger may have already populated it
-- with a freshly-created room code (when a waiting partner exists). Restricting
-- to player_id = auth.uid() is sufficient: the client cannot fabricate a
-- game_id because the games table's RLS would reject any row that user didn't
-- create, so a bogus game_id here is harmless.
DROP POLICY IF EXISTS queue_insert_own ON public.queue;
CREATE POLICY queue_insert_own ON public.queue
  FOR INSERT WITH CHECK (player_id = auth.uid());

DROP POLICY IF EXISTS queue_delete_own ON public.queue;
CREATE POLICY queue_delete_own ON public.queue
  FOR DELETE USING (player_id = auth.uid());

-- Realtime: subscribers see their own row's UPDATE (when game_id is set by trigger).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'queue'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.queue';
  END IF;
END$$;

-- Pairing trigger: on INSERT, try to grab an older unmatched row and create a game.
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
    -- Nobody waiting — this player keeps the spot for someone else to find.
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

DROP TRIGGER IF EXISTS queue_pair_on_insert ON public.queue;
CREATE TRIGGER queue_pair_on_insert
  BEFORE INSERT ON public.queue
  FOR EACH ROW
  EXECUTE FUNCTION public.pair_queue();
