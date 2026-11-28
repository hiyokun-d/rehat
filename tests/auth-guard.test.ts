import { describe, expect, test } from "bun:test";
import type { Profile } from "../src/generated/prisma/client";
import {
  type GuardDeps,
  requireRoleWith,
  requireUser,
} from "../src/lib/auth/guard";
import { HttpError } from "../src/lib/auth/http";

const profile = (role: Profile["role"]) =>
  ({ id: "u1", role, displayName: "x" }) as Profile;

function deps(user: { id: string } | null, found: Profile | null): GuardDeps {
  return { getUser: async () => user, findProfile: async () => found };
}

const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e) => (e instanceof HttpError ? e.status : 500),
  );

describe("guard", () => {
  test("401 without a session", async () => {
    expect(await status(requireUser(deps(null, null)))).toBe(401);
  });

  test("403 when the session has no Profile", async () => {
    expect(await status(requireUser(deps({ id: "u1" }, null)))).toBe(403);
  });

  test("403 when the Profile role is not allowed", async () => {
    const d = deps({ id: "u1" }, profile("CAREGIVER"));
    expect(await status(requireRoleWith(d, ["THERAPIST"]))).toBe(403);
  });

  test("returns the Profile when the role matches", async () => {
    const d = deps({ id: "u1" }, profile("THERAPIST"));
    const p = await requireRoleWith(d, ["PATIENT", "THERAPIST"]);
    expect(p.role).toBe("THERAPIST");
  });

  test("fails closed with no roles", async () => {
    const d = deps({ id: "u1" }, profile("THERAPIST"));
    expect(await status(requireRoleWith(d, []))).toBe(403);
  });

  test("role comes from the Profile lookup, not the session user", async () => {
    const d: GuardDeps = {
      getUser: async () => ({ id: "u1", role: "THERAPIST" }) as { id: string },
      findProfile: async () => profile("PATIENT"),
    };
    expect(await status(requireRoleWith(d, ["THERAPIST"]))).toBe(403);
  });
});
