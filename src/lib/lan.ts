// This machine's LAN IPv4 addresses (e.g. 192.168.1.29), for the phone to reach it.
// Server-side only (uses node:os).
import { networkInterfaces } from "node:os";

export function lanIps(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a?.address as string);
}
