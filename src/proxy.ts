// Refreshes the Supabase session cookie and nothing else. This is NOT an authorization
// boundary: role and patient-relationship checks live in src/lib/auth/guard.ts and run in
// each route handler. Next only picks this file up from src/ because the app lives in src/app.
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // The phone/screen prototype must keep working before Supabase is configured.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next();
  }
  const { response } = await updateSession(request);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
