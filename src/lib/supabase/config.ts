// NEXT_PUBLIC_* must be read as literal `process.env.NAME` so Next can inline them in the
// browser bundle. Both values are public by design; row-level security protects the data.
export function supabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum diisi. Lihat .env.example.",
    );
  }
  return { url, anonKey };
}
