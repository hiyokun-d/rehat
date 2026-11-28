import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  fetchBreaches,
  fetchSessions,
} from "../src/app/screen/_lib/historyApi";
import {
  type BreachState,
  loadBreachesState,
  loadSessionsState,
  type PanelState,
  ServerHistoryView,
} from "../src/app/screen/ServerHistory";

const session = {
  id: "s1",
  patientId: "p1",
  planExerciseId: "pe1",
  status: "COMPLETED",
  reportedBy: "CAREGIVER",
  startedAt: "2026-11-28T03:00:00.000Z",
  endedAt: null,
  envelopeVersion: 2,
  attempt: {
    reps: 7,
    activeMs: 60000,
    maxAngleDeg: 41.6,
    maxVelDegPerS: 80,
    pauses: 1,
  },
};
const breach = {
  id: "b1",
  sessionId: "s1",
  kind: "ANGLE",
  value: 52.4,
  limit: 45,
  heldMs: 320,
  occurredAt: "2026-11-28T03:01:00.000Z",
};

function mockFetch(status: number, body: unknown = {}) {
  const urls: string[] = [];
  const impl = async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, urls };
}

const noop = () => {};
function render(
  state: PanelState,
  openId: string | null = null,
  breaches: Record<string, BreachState> = {},
) {
  return renderToStaticMarkup(
    <ServerHistoryView
      state={state}
      openId={openId}
      breaches={breaches}
      onLogin={async () => null}
      onSignOut={noop}
      onOpen={noop}
      onMore={noop}
      onRetry={noop}
    />,
  );
}

describe("/screen Riwayat server: fetch -> state -> render", () => {
  test("200 -> sessions rendered with the therapist-limit wording", async () => {
    const f = mockFetch(200, {
      items: [session],
      page: 1,
      limit: 20,
      hasMore: false,
    });
    const state = await loadSessionsState(1, [], f.impl);
    expect(f.urls[0]).toBe("/api/sessions?page=1&limit=20");
    expect(state.kind).toBe("ready");
    const html = render(state);
    expect(html).toContain("Dikerjakan");
    expect(html).toContain("7 repetisi");
    expect(html).toContain("sudut maks 42°");
    expect(html).toContain("Pendamping");
    expect(html).not.toContain("Muat lebih banyak");
  });

  test("hasMore shows the load-more button", async () => {
    const f = mockFetch(200, {
      items: [session],
      page: 1,
      limit: 20,
      hasMore: true,
    });
    expect(render(await loadSessionsState(1, [], f.impl))).toContain(
      "Muat lebih banyak",
    );
  });

  test("empty list says so", async () => {
    const f = mockFetch(200, { items: [], page: 1, limit: 20, hasMore: false });
    expect(render(await loadSessionsState(1, [], f.impl))).toContain(
      "Belum ada sesi",
    );
  });

  test("401 -> login form and the local-mode label (fallback)", async () => {
    const state = await loadSessionsState(1, [], mockFetch(401).impl);
    expect(state.kind).toBe("login");
    const html = render(state);
    expect(html).toContain("Mode lokal: belum masuk");
    expect(html).toContain('type="password"');
  });

  test("403 -> not-a-therapist message, no login form", async () => {
    const state = await loadSessionsState(1, [], mockFetch(403).impl);
    expect(state.kind).toBe("forbidden");
    const html = render(state);
    expect(html).toContain("Akun ini bukan terapis");
    expect(html).not.toContain('type="password"');
  });

  test("500 and network failure -> error state with retry", async () => {
    expect((await loadSessionsState(1, [], mockFetch(500).impl)).kind).toBe(
      "error",
    );
    const down = async () => {
      throw new Error("offline");
    };
    const state = await loadSessionsState(1, [], down);
    expect(state.kind).toBe("error");
    expect(render(state)).toContain("Coba lagi");
  });

  test("breaches of an opened session render with the therapist's limit", async () => {
    const f = mockFetch(200, {
      sessionId: "s1",
      items: [breach],
      page: 1,
      limit: 20,
      hasMore: false,
    });
    const b = await loadBreachesState("s1", f.impl);
    expect(f.urls[0]).toBe("/api/breaches?sessionId=s1&page=1&limit=20");
    const sessionsState = await loadSessionsState(
      1,
      [],
      mockFetch(200, { items: [session], page: 1, limit: 20, hasMore: false })
        .impl,
    );
    const html = render(sessionsState, "s1", { s1: b });
    expect(html).toContain("52°");
    expect(html).toContain("batas terapis 45");
    expect(html).toContain("320 ms");
  });

  test("breach 404/500 -> error text, session without breaches -> empty text", async () => {
    expect((await loadBreachesState("s1", mockFetch(404).impl)).kind).toBe(
      "error",
    );
    const s = await loadSessionsState(
      1,
      [],
      mockFetch(200, { items: [session], page: 1, limit: 20, hasMore: false })
        .impl,
    );
    expect(render(s, "s1", { s1: { kind: "ready", items: [] } })).toContain(
      "Tidak ada kejadian melewati batas terapis",
    );
  });

  test("helpers map statuses to errors", async () => {
    expect(await fetchSessions(1, mockFetch(401).impl)).toEqual({
      ok: false,
      error: "login",
    });
    expect(await fetchBreaches("s1", 1, mockFetch(404).impl)).toEqual({
      ok: false,
      error: "notfound",
    });
  });

  test("the panel never shows adherence or recovery wording", async () => {
    const f = mockFetch(200, {
      items: [session],
      page: 1,
      limit: 20,
      hasMore: false,
    });
    const html = render(await loadSessionsState(1, [], f.impl)).toLowerCase();
    for (const word of ["pemulihan", "recovery", "aman", "%"])
      expect(html).not.toContain(word);
  });
});
