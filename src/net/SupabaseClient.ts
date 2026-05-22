import { createClient, SupabaseClient as SbClient, User } from '@supabase/supabase-js';

/**
 * Lazy-init wrapper around the Supabase JS client.
 *
 * Credentials come from Vite env vars (see .env.example):
 *   VITE_SUPABASE_URL      — https://<project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY — public anon key (safe to ship to the browser)
 *
 * Both are required only when multiplayer is actually used. The single-player
 * paths (hot-seat, vs AI) never call into this module, so an unconfigured
 * Supabase project never breaks the rest of the game.
 *
 * Identity model: Anonymous Auth. The first call to `signInAnon()` creates a
 * fresh user row in auth.users with a UUID; subsequent calls reuse the session
 * persisted in localStorage so the UUID is stable per browser. That UUID is
 * what RLS uses to bind a player to a game's white_id / black_id.
 */

let cachedClient: SbClient | null = null;
let cachedUser: User | null = null;

export class SupabaseConfigError extends Error {
  constructor(missing: string) {
    super(
      `Multiplayer is not configured: ${missing} is missing from .env.\n` +
      `See .env.example for the two values to set, then restart the dev server.`,
    );
    this.name = 'SupabaseConfigError';
  }
}

function readEnv(): { url: string; anonKey: string } {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url) throw new SupabaseConfigError('VITE_SUPABASE_URL');
  if (!anonKey) throw new SupabaseConfigError('VITE_SUPABASE_ANON_KEY');
  return { url, anonKey };
}

export function getClient(): SbClient {
  if (cachedClient) return cachedClient;
  const { url, anonKey } = readEnv();
  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    },
    realtime: {
      params: {
        // Aim for snappy move broadcasts; default is 10/s which is fine for chess.
        eventsPerSecond: 10,
      },
    },
  });
  return cachedClient;
}

/**
 * Sign in (or re-attach) an anonymous user. Returns the user's stable UUID.
 *
 * Supabase Anonymous Auth must be enabled for the project:
 *   Dashboard → Authentication → Providers → Anonymous → toggle on.
 *
 * If it's not enabled, `signInAnonymously()` returns
 * "Anonymous sign-ins are disabled" which we surface verbatim.
 */
export async function signInAnon(): Promise<User> {
  if (cachedUser) return cachedUser;
  const sb = getClient();

  // Re-use the persisted session if there is one.
  const { data: existing } = await sb.auth.getUser();
  if (existing.user) {
    cachedUser = existing.user;
    return existing.user;
  }

  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error('Anonymous sign-in returned no user');
  cachedUser = data.user;
  // The Realtime websocket was opened during getClient() in an unauthenticated
  // state. Channels created BEFORE this point won't receive postgres_changes
  // events under default RLS-enabled Realtime settings. Push the new JWT into
  // the realtime client so subsequent channels — and any reconnects — carry it.
  if (data.session?.access_token) {
    sb.realtime.setAuth(data.session.access_token);
  }
  return data.user;
}

/** Returns the cached anon user UUID if signed in, else null. */
export function currentUserId(): string | null {
  return cachedUser?.id ?? null;
}

/** Forget the cached client + user. Used by tests; not needed in normal play. */
export function _reset(): void {
  cachedClient = null;
  cachedUser = null;
}
