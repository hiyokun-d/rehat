// Security headers for every page and API response (OWASP A02 Security Misconfiguration).
// Kept as data so tests can check them and next.config.ts stays short.
//
// CSP notes:
// - script 'unsafe-inline': Next injects inline bootstrap scripts; a nonce-based CSP would need
//   dynamic rendering of every page. Trade-off accepted for the MVP; XSS is still limited because
//   React escapes output and we never use dangerouslySetInnerHTML with user data.
// - 'wasm-unsafe-eval': MediaPipe / LiteRT run WebAssembly (lab pages).
// - 'unsafe-eval' only in dev (React Refresh).
// - connect-src: our own origin + Supabase (REST, Auth, Realtime websocket). Nothing else: no
//   analytics, no third-party trackers on a health app.
// - frame-ancestors 'none': devicemotion must not run in a cross-origin iframe anyway (AGENTS.md),
//   and it blocks clickjacking.
export function securityHeaders(opts: {
  dev: boolean;
  supabaseUrl?: string;
}): { key: string; value: string }[] {
  const sb = opts.supabaseUrl ? new URL(opts.supabaseUrl).host : "";
  const connect = [
    "'self'",
    sb && `https://${sb}`,
    sb && `wss://${sb}`,
    opts.dev && "ws:",
    opts.dev && "wss:",
  ].filter(Boolean);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      // Motion sensors + camera only for our own pages; nothing else is ever needed.
      key: "Permissions-Policy",
      value:
        "accelerometer=(self), gyroscope=(self), magnetometer=(self), camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(opts.dev
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ]),
  ];
}

/**
 * CSRF defence in depth for cookie-authenticated API calls. Supabase's cookies are SameSite=Lax
 * (no cross-site POST), and this also refuses a state-changing request whose Origin is another
 * site. GET/HEAD/OPTIONS pass. A request with no Origin header (curl, server-to-server) passes:
 * it carries no victim's cookies unless the caller already has them.
 */
export function isCrossSiteWrite(
  method: string,
  origin: string | null,
  host: string | null,
  allowed: readonly string[],
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  if (!origin) return false;
  let o: string;
  try {
    o = new URL(origin).host;
  } catch {
    return true;
  }
  if (host && o === host) return false;
  return !allowed.some((a) => {
    try {
      return new URL(a.includes("://") ? a : `https://${a}`).host === o;
    } catch {
      return false;
    }
  });
}
