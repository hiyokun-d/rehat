// Helper for Next 16's `proxy.ts` (the renamed middleware). Refreshes the Supabase session
// cookie on each request and returns the response to hand back. It decides nothing about
// routes: redirects per role belong in the caller. Not wired yet; there is no src/proxy.ts.
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { supabaseConfig } from "./config";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // getUser() validates the token with Supabase; getSession() would trust the cookie as is.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
