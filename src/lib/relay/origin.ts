// Origin check for the relay upgrade (R1-K1). Free of `ws`/`next` so server.mts and tests share it.
//
// Accepted browser origins, matched by hostname only (scheme and port are ignored, so the
// HTTP:3000 / HTTPS:3443 pair and the TLS pass-through all work):
//  - localhost, 127.0.0.1 and this machine's LAN IPs (the dev default);
//  - hosts listed in ALLOWED_ORIGINS (comma separated; a bare host or a full origin URL);
//  - a cloudflared quick tunnel (*.trycloudflare.com, as in next.config.ts), but only when the
//    Origin host is the same as the Host header of the request. Anyone can open a trycloudflare
//    tunnel, so the suffix alone would trust other people's pages; same-host means the page was
//    served through the tunnel that reached this server.
const TUNNEL_SUFFIX = ".trycloudflare.com";

function hostnameOf(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(v.includes("://") ? v : `https://${v}`).hostname;
  } catch {
    return null;
  }
}

/** Hostnames from a comma-separated ALLOWED_ORIGINS value. Invalid entries are dropped. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map(hostnameOf)
    .filter((h): h is string => h !== null);
}

export function makeOriginCheck(
  lanHosts: string[],
  allowedOrigins: string | undefined,
): (origin: string | undefined, hostHeader: string | undefined) => boolean {
  const allowed = new Set<string>([
    "localhost",
    "127.0.0.1",
    ...lanHosts,
    ...parseAllowedOrigins(allowedOrigins),
  ]);
  return (origin, hostHeader) => {
    // A non-browser client (no Origin) is refused: real phones and the laptop always send one.
    if (!origin) return false;
    const host = hostnameOf(origin);
    if (!host) return false;
    if (allowed.has(host)) return true;
    return (
      host.endsWith(TUNNEL_SUFFIX) &&
      !!hostHeader &&
      hostnameOf(hostHeader) === host
    );
  };
}
