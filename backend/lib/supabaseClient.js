const { createClient } = require("@supabase/supabase-js");

let client = null;

/**
 * The server-side key, under either of the names it goes by.
 *
 * Supabase's dashboard has relabelled this key over time: older projects show
 * it as "service_role", newer ones as "Secret key". Accepting both names
 * avoids the worst failure mode here — a misnamed variable does not error, it
 * silently leaves the server in read-only JSON mode, which is hard to trace
 * back to a typo in .env.
 */
function getServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
}

/**
 * True when the server has everything it needs to talk to Supabase.
 * Used to decide which store implementation to mount, so a checkout with no
 * Supabase configured still runs against the legacy JSON file.
 */
function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && getServiceKey());
}

/**
 * Built lazily so a missing variable surfaces as a handled error on the first
 * query rather than crashing the process at import time.
 *
 * This key bypasses RLS and must therefore only ever run on the server. It is
 * why every route that reaches this layer does its own authorisation first.
 */
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = getServiceKey();

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(or SUPABASE_SECRET_KEY) in backend/.env"
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

module.exports = { getSupabase, isSupabaseConfigured, resetSupabaseClient, getServiceKey };
