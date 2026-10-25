import { supabase } from "./supabase.js";

export const configured = !!supabase;

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
// Returns true if the user is logged in straight away, false if they must confirm their email first.
export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) throw error;
  return !!data.session;
}
export const signOut = () => supabase.auth.signOut();
export const onAuthChange = (cb) => supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
