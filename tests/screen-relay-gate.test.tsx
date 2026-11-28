import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { liveRelayEnabled } from "../src/app/screen/_lib/liveGate";
import { LocalModeNotice } from "../src/app/screen/LocalModeNotice";
import { ApiError } from "../src/lib/api/client";
import { makeTicketProvider } from "../src/lib/api/wsTicket";

function api(result: "ok" | ApiError) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async requestWsTicket() {
      calls += 1;
      if (result !== "ok") throw result;
      return { ticket: "tkt-1", role: "screen" as const, expiresInMs: 60_000 };
    },
  };
}

describe("/screen live relay: therapist signed in", () => {
  test("relay is enabled and every connect gets a ticket", async () => {
    expect(liveRelayEnabled(true, true)).toBe(true);
    const a = api("ok");
    const getTicket = makeTicketProvider(a, () => true);
    expect(await getTicket()).toBe("tkt-1");
    expect(await getTicket()).toBe("tkt-1");
    expect(a.calls).toBe(2);
  });

  test("a rejected ticket (401/403) is final, a 5xx is retried by the hook", async () => {
    const denied = makeTicketProvider(api(new ApiError(401, "x")), () => true);
    expect(await denied()).toBeNull();
    const down = makeTicketProvider(api(new ApiError(503, "x")), () => true);
    await expect(down()).rejects.toBeInstanceOf(ApiError);
  });

  test("relay waits until the room is restored", () => {
    expect(liveRelayEnabled(false, true)).toBe(false); // room not restored yet
  });
});

describe("/screen live relay: not signed in (local fallback)", () => {
  test("relay never connects, before the probe answers or after it says no", () => {
    expect(liveRelayEnabled(true, null)).toBe(false);
    expect(liveRelayEnabled(true, false)).toBe(false);
  });

  test("a ticket is never requested without a login", async () => {
    const a = api("ok");
    expect(await makeTicketProvider(a, () => false)()).toBeNull();
    expect(a.calls).toBe(0);
  });

  test("the local-mode label is shown and explains why live is missing", () => {
    const html = renderToStaticMarkup(<LocalModeNotice />);
    expect(html).toContain("Mode lokal: belum masuk sebagai terapis");
    expect(html).toContain("tiket");
    expect(html).toContain("Riwayat");
  });
});
