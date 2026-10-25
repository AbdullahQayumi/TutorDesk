import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// null until the keys are in .env (the login screen then shows a setup message).
// Only ever use the anon/publishable key here, never the service_role / secret key.
export const supabase = url && key ? createClient(url, key) : null;
