import type { NextConfig } from "next";
import { lanIps } from "./src/lib/lan.ts";

const nextConfig: NextConfig = {
  // Next dev blocks dev assets for hostnames other than localhost. The phone reaches us via
  // this machine's LAN IP (detected automatically) or a cloudflared quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com", ...lanIps()],
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
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
