import { json, jsonError } from "@/lib/auth/http";
import { allowAttempt, clientIp } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type AuthAdmin,
  signupOpen,
  signupSchema,
  signupStaff,
} from "../../_domain/care";

/**
 * Open nurse / therapist sign-up. Creates the auth user and a THERAPIST profile that owns no
 * patients yet. The browser then signs in with the same email + password.
 */
export async function POST(request: Request) {
  try {
    if (!signupOpen())
      return json(
        { error: "Pendaftaran ditutup. Hubungi pengelola Rehat." },
        403,
      );
    if (!allowAttempt(`signup:${clientIp(request)}`, 5))
      return json(
        { error: "Terlalu banyak pendaftaran. Coba lagi nanti." },
        429,
      );
    const parsed = signupSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return json(
        {
          error:
            "Lengkapi nama, email, kata sandi (minimal 10 karakter), dan centang pernyataan.",
        },
        400,
      );
    const admin = createAdminClient().auth.admin as unknown as AuthAdmin;
    return json(await signupStaff(prisma, admin, parsed.data), 201);
  } catch (err) {
    return jsonError(err);
  }
}
