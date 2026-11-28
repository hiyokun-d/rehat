-- Live rooms on Supabase Realtime (replaces the ws relay on Vercel, which has no WebSockets).
--
-- One private channel per patient: topic "patient:<Profile.id>". Every phone on that patient's
-- body (arm, forearm, leg, head ...) and every screen watching that patient joins the same topic.
-- Different patients never share a topic, so their data cannot mix or collide.
--
-- Who may join (send AND receive, broadcast + presence) "patient:<id>":
--   * the patient themself (auth.uid() = id)
--   * the patient's therapist / nurse (Profile.therapistId = auth.uid())
--   * a caregiver with an ACTIVE, consented CareLink
-- Same relationship rule as /api/sync (BOLA). Everyone else is denied by RLS.
-- The client must open the channel with { config: { private: true } }. Also turn OFF
-- "Allow public access" in Supabase > Realtime > Settings so public channels cannot be used at all.

CREATE OR REPLACE FUNCTION public.rehat_can_access_patient(pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "Profile" p
    WHERE p."id" = pid
      AND p."deletedAt" IS NULL
      AND p."role" = 'PATIENT'
      AND (
        p."id" = auth.uid()
        OR p."therapistId" = auth.uid()
        OR EXISTS (
          SELECT 1 FROM "CareLink" c
          WHERE c."patientId" = pid
            AND c."caregiverId" = auth.uid()
            AND c."status" = 'ACTIVE'
            AND c."consentAt" IS NOT NULL
            AND c."deletedAt" IS NULL
        )
      )
  );
$$;

-- Topic -> patient id, or NULL for anything that is not exactly "patient:<uuid>".
-- Never casts untrusted text without checking the shape first.
CREATE OR REPLACE FUNCTION public.rehat_topic_patient(topic text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN topic ~ '^patient:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN substring(topic FROM 9)::uuid
  END;
$$;

REVOKE ALL ON FUNCTION public.rehat_can_access_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rehat_can_access_patient(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rehat_topic_patient(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rehat_topic_patient(text) TO authenticated;

DROP POLICY IF EXISTS "rehat_patient_room_receive" ON realtime.messages;
CREATE POLICY "rehat_patient_room_receive"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND public.rehat_can_access_patient(public.rehat_topic_patient((SELECT realtime.topic())))
);

DROP POLICY IF EXISTS "rehat_patient_room_send" ON realtime.messages;
CREATE POLICY "rehat_patient_room_send"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND public.rehat_can_access_patient(public.rehat_topic_patient((SELECT realtime.topic())))
);
