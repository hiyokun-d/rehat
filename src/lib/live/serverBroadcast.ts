// Server-side push into a private Realtime channel, through Supabase's broadcast REST endpoint
// with the service-role key (bypasses RLS, so callers MUST have checked authorization first).
// Used for events that must be audited and must not depend on a browser tab being open:
// a patient's help request (-> staff:<nurse>) and a nurse's message (-> patient:<id>).
import { LIVE_EVENT, type LiveMsg } from "./protocol";

export async function serverBroadcast(
  topic: string,
  msg: Omit<LiveMsg, "from" | "t">,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const payload: LiveMsg = { ...msg, from: "server", t: Date.now() };
  try {
    const res = await fetchImpl(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic, event: LIVE_EVENT, payload, private: true }],
      }),
    });
    return res.ok;
  } catch {
    // The audit row is already written; the dashboard also reads open requests from it.
    return false;
  }
}

export const staffTopic = (staffId: string) => `staff:${staffId}`;
