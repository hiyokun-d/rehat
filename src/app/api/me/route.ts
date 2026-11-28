import { requireUser } from "@/lib/auth/guard";
import { json, jsonError } from "@/lib/auth/http";

/** The caller's own Profile and role. */
export async function GET() {
  try {
    const me = await requireUser();
    return json({
      id: me.id,
      role: me.role,
      displayName: me.displayName,
      therapistId: me.therapistId,
    });
  } catch (err) {
    return jsonError(err);
  }
}
