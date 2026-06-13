# Supabase Migration Apply Notes

## Files

| File | Status | Description |
|------|--------|-------------|
| `migrations/001_init.sql` | Applied (2026-05-22) | Base schema: games table, RLS, Realtime |
| `migrations/002_queue.sql` | Applied (2026-05-22) | Matchmaking queue table + pair_queue() trigger |
| `migrations/003_security_hardening.sql` | **PENDING** | Security hardening (F6, F7, F22) |

---

## How to Apply 003_security_hardening.sql

### Step 1: Open the SQL Editor

1. Go to https://supabase.com/dashboard/project/mliblrxegsrylebaslhr
2. Click **SQL Editor** in the left sidebar.
3. Click **+ New query**.

### Step 2: Paste and run

Copy the entire contents of `supabase/migrations/003_security_hardening.sql` into the editor and click **Run**.

The migration is idempotent: you can safely run it more than once. If it was partially applied before, re-running will be harmless.

### Step 3: Verify

Run the verification query below in a new SQL editor tab:

```sql
-- Verify enforce_game_invariants trigger exists on games.
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.games'::regclass
  AND tgname = 'enforce_game_invariants';
-- Expected: 1 row, tgenabled = 'O' (origin)

-- Verify resign_game function exists.
SELECT proname, prosecdef FROM pg_proc
WHERE proname = 'resign_game' AND pronamespace = 'public'::regnamespace;
-- Expected: 1 row, prosecdef = true

-- Verify UNIQUE constraint on queue.player_id.
SELECT conname FROM pg_constraint
WHERE conname = 'queue_player_id_unique'
  AND conrelid = 'public.queue'::regclass;
-- Expected: 1 row

-- Verify clock columns exist on games.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'games'
  AND column_name IN ('white_ms', 'black_ms');
-- Expected: 2 rows, data_type = 'bigint', column_default = NULL

-- Check updated RLS policies on games.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'games' AND schemaname = 'public'
ORDER BY policyname;
-- Expected policies: games_select_all, games_insert_as_white, games_join_as_black, games_play_move
```

---

## What This Migration Fixes

### F6: games_play_move allowed direct result writes

**Root cause:** RLS UPDATE policies only see the *new* row (WITH CHECK) and the *old* row
(USING), but they cannot compare OLD vs NEW values. The `games_play_move` WITH CHECK only
verified `auth.uid() IN (white_id, black_id)`, so a player could set `result='1-0'` in the
same UPDATE that submitted their move.

**Fix:** A `BEFORE UPDATE` trigger `enforce_game_invariants` now runs before every UPDATE on
`games`. It has access to both OLD and NEW (unlike RLS) and raises an exception if `result`
changes outside of the `resign_game()` path. The trigger communicates with `resign_game()`
via the session-scoped config key `chess3d.resign_caller`.

### F7: games_join_as_black allowed overwriting fen/moves/result

**Root cause:** Same RLS limitation. The join policy WITH CHECK only verified
`black_id = auth.uid()`, so a joiner could simultaneously rewrite `fen`, `moves`, or `result`
while claiming the black slot.

**Fix:** The `enforce_game_invariants` trigger detects the join path (OLD.black_id IS NULL,
NEW.black_id = caller) and asserts that `fen`, `moves`, and `result` are all unchanged.
The RLS join policy was also tightened to add `result IS NULL` to the USING clause.

### F22 matchmaking: missing UNIQUE + stale rows

**Root cause:** `queue.player_id` had no UNIQUE constraint, so one player could insert
multiple rows and appear as multiple "partners" in the SKIP LOCKED scan.

**Fix:**
- Added `UNIQUE (player_id)` constraint on `queue`.
- The `pair_queue()` trigger now runs a DELETE for unmatched rows older than 5 minutes
  before scanning for a partner, keeping the queue lean without a cron job.
- A standalone `cleanup_stale_queue()` SECURITY DEFINER function is also available for
  manual or pg_cron invocation.

---

## Client Compatibility Warning

**003 is NOT yet applied in production.** The client (fixed separately in other packages)
must feature-detect `resign_game` and fall back gracefully:

```ts
// Pseudo-code in MultiplayerSession.ts (updated by the client package fixer, not here)
const { error } = await supabase.rpc('resign_game', { p_game_id: gameId });
if (error?.code === 'PGRST202') {
  // Function not found -- 003 not applied yet. Fall back to direct UPDATE.
  // WARNING: the direct UPDATE path is vulnerable to F6 until 003 is applied.
  await supabase.from('games').update({ result: opponentWins }).eq('id', gameId);
}
```

`PGRST202` is the PostgREST error code for "Could not find the function". The fallback
direct UPDATE will succeed under the old RLS (001) but will be rejected by the
`enforce_game_invariants` trigger once 003 is applied, so the fallback path is only
active in the window between old client and new migration.

---

## Clock Columns (Forward-Compat)

`games.white_ms` and `games.black_ms` (nullable bigint, default NULL) are added for
Phase 7-D chess clock support. The client feature-detects them:

```ts
// In NetworkPlayer.ts or MultiplayerSession.ts:
// If white_ms / black_ms are null (or the column doesn't exist), run without a clock.
// Only activate the clock UI when both columns are non-null in the fetched row.
```

NULL means "no clock / time-unlimited game" -- existing games are unaffected.

---

## Rollback

If you need to revert 003:

```sql
-- Remove trigger and function.
DROP TRIGGER IF EXISTS enforce_game_invariants ON public.games;
DROP FUNCTION IF EXISTS public.enforce_game_invariants();
DROP FUNCTION IF EXISTS public.resign_game(text);
DROP FUNCTION IF EXISTS public.cleanup_stale_queue();

-- Remove UNIQUE constraint on queue.
ALTER TABLE public.queue DROP CONSTRAINT IF EXISTS queue_player_id_unique;

-- Remove clock columns.
ALTER TABLE public.games DROP COLUMN IF EXISTS white_ms;
ALTER TABLE public.games DROP COLUMN IF EXISTS black_ms;

-- Restore original policies from 001_init.sql (paste from that file).
```

After rollback, re-run `001_init.sql` and `002_queue.sql` to restore the baseline state.
