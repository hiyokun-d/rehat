"use client";
// Which layout to render: phone (one column, plain words, big targets) or desktop (dense table,
// every number). Decided by viewport width, not user agent: a tablet in landscape gets the
// desktop view, a narrow laptop window gets the phone view. 1024 px = Tailwind `lg`.
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** `?view=phone` or `?view=desktop` forces a layout (demos on a laptop projector, testing). */
function forced(): boolean | undefined {
  const v = new URLSearchParams(window.location.search).get("view");
  return v === "phone" ? false : v === "desktop" ? true : undefined;
}

export function useIsDesktop(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => forced() ?? window.matchMedia(QUERY).matches,
    () => null, // server render: unknown until hydrated
  );
}
