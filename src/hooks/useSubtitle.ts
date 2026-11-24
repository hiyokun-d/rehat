"use client";
// Words append into one line; the line clears after a quiet period (brief: ~4 s).
import { useCallback, useEffect, useState } from "react";

export const SUBTITLE_CLEAR_MS = 4000;

export function useSubtitle() {
  const [words, setWords] = useState<string[]>([]);

  // Every new word restarts the timer (the effect re-runs because `words` changed).
  useEffect(() => {
    if (!words.length) return;
    const id = setTimeout(() => setWords([]), SUBTITLE_CLEAR_MS);
    return () => clearTimeout(id);
  }, [words]);

  const add = useCallback((w: string) => setWords((ws) => [...ws, w]), []);

  return { words, add };
}
