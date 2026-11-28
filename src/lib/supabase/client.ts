import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

/** Browser client. Uses the anon key only; never import admin.ts from client code. */
export function createClient() {
  const { url, anonKey } = supabaseConfig();
  return createBrowserClient(url, anonKey);
}
