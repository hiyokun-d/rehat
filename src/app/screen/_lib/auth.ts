// Minimal therapist login for /screen. Uses the F1 browser Supabase client, which keeps the
// session in cookies, so the server routes (requireRole) see the same login. The role is NOT
// read here: the server decides it from the Profile table, and answers 403 for non-therapists.
import { createClient } from "@/lib/supabase/client";

/** Returns an error message for the user, or null on success. Never echoes provider details. */
export async function signInTherapist(
  email: string,
  password: string,
): Promise<string | null> {
  try {
    const { error } = await createClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return error ? "Email atau kata sandi salah." : null;
  } catch {
    // supabaseConfig() throws when the NEXT_PUBLIC_SUPABASE_* vars are not set.
    return "Login belum dikonfigurasi di server ini.";
  }
}

export async function signOutTherapist(): Promise<void> {
  try {
    await createClient().auth.signOut();
  } catch {}
}
