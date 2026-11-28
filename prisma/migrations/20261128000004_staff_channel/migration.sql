-- One private channel per nurse/therapist: topic "staff:<Profile.id>". Carries urgent events for
-- ALL of that nurse's patients (help requests), so the dashboard needs one subscription, not one
-- per patient. Only the server writes to it (service role, after checking who the patient is,
-- see POST /api/help); only the owning staff member may read it. Patients cannot read or write it.

CREATE OR REPLACE FUNCTION public.rehat_topic_staff(topic text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN topic ~ '^staff:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN substring(topic FROM 7)::uuid
  END;
$$;

REVOKE ALL ON FUNCTION public.rehat_topic_staff(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rehat_topic_staff(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rehat_is_staff(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Profile" p
    WHERE p."id" = uid AND p."role" = 'THERAPIST' AND p."deletedAt" IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.rehat_is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rehat_is_staff(uuid) TO authenticated;

DROP POLICY IF EXISTS "rehat_staff_room_receive" ON realtime.messages;
CREATE POLICY "rehat_staff_room_receive"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND public.rehat_topic_staff((SELECT realtime.topic())) = auth.uid()
  AND public.rehat_is_staff(auth.uid())
);
-- No INSERT policy for staff:*: clients never send there; the server does with the service role.
