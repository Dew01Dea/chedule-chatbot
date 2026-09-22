const { isSupabaseConfigured } = require("../lib/supabaseClient");
const supabaseStore = require("./supabaseStore");
const jsonStore = require("./jsonStore");

/**
 * Picks the store at import time.
 *
 * With Supabase configured the app is multi-teacher. Without it, it falls back
 * to the original single-file store so an existing checkout keeps answering
 * about the one teacher it already had, rather than failing to boot.
 */
const store = isSupabaseConfigured() ? supabaseStore : jsonStore;

module.exports = store;
module.exports.supabaseStore = supabaseStore;
module.exports.jsonStore = jsonStore;
module.exports.isMultiTeacher = store.name === "supabase";
