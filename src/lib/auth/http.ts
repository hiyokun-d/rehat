import { ZodError } from "zod";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE, ...headers },
  });
}

/** Maps a thrown value to a response. Never echoes payloads or internal messages on 5xx. */
export function jsonError(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  if (err instanceof ZodError) {
    return json({ error: "Permintaan tidak valid." }, 400);
  }
  console.error("route error:", err instanceof Error ? err.name : "unknown");
  return json({ error: "Terjadi kesalahan pada server." }, 500);
}

/** Reads and validates a JSON body at the route boundary. Throws ZodError when invalid. */
export async function parseBody<T>(
  request: Request,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  const raw: unknown = await request.json().catch(() => null);
  return schema.parse(raw);
}
