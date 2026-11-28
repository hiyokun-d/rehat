// Refreshes the Supabase session cookie and nothing else. This is NOT an authorization
// boundary: role and patient-relationship checks live in src/lib/auth/guard.ts and run in
// each route handler. Next only picks this file up from src/ because the app lives in src/app.
import { type NextRequest, NextResponse } from "next/server";
import { isCrossSiteWrite } from "@/lib/security/headers";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // CSRF defence in depth (src/lib/security/headers.ts): refuse cross-site writes to the API.
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    isCrossSiteWrite(
      request.method,
      request.headers.get("origin"),
      request.headers.get("host"),
      (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
    )
  ) {
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }
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
