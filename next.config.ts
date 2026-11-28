import type { NextConfig } from "next";
import { lanIps } from "./src/lib/lan.ts";
import { securityHeaders } from "./src/lib/security/headers.ts";

const nextConfig: NextConfig = {
  // Next dev blocks dev assets for hostnames other than localhost. The phone reaches us via
  // this machine's LAN IP (detected automatically) or a cloudflared quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com", ...lanIps()],
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Not on /_next/* : in dev, headers on Next's own HMR / RSC endpoints made the dev client
        // refetch nonstop ("Compiled" + reload loop, verified 28 Nov 2026). Our pages and /api
        // still get every header; /_next/static is hashed JS/CSS.
        source: "/((?!_next/).*)",
        headers: securityHeaders({
          dev: process.env.NODE_ENV !== "production",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
