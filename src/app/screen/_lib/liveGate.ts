/**
 * The relay needs a ticket, a ticket needs a login, so the live connection is attempted only for
 * a signed-in therapist. `therapist` is null until the first probe answers, false without a
 * therapist login (local mode, no connection attempts, no retry loop against a 401).
 */
export function liveRelayEnabled(ready: boolean, therapist: boolean | null) {
  return ready && therapist === true;
}
