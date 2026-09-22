const { createClient } = require("@supabase/supabase-js");

let client = null;

/**
 * True when the server has everything it needs to talk to Supabase.
 * Used to decide which store implementation to mount, so a checkout with no
 * Supabase configured still runs against the legacy JSON file.
 */
function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Built lazily so a missing variable surfaces as a handled error on the first
 * query rather than crashing the process at import time.
 *
 * This uses the service role key and must therefore only ever run on the
 * server. It bypasses RLS, which is why every route that reaches it goes
 * through its own authorisation check first.
 */
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env"
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}

/** Test seam: drops the memoised client. */
function resetSupabaseClient() {
  client = null;
}

module.exports = { getSupabase, isSupabaseConfigured, resetSupabaseClient };
