"use client";
// One page, two recognisers: "Kata saya" (your own recorded gestures, any language) and
// "ASL siap pakai" (pretrained, 250 ASL signs, nothing to record). Only one is mounted at a
// time, so only one uses the camera. ?mode=asl opens the ASL one (used by the pairing QR).
import { Hand, HandHelping } from "lucide-react";
import { useEffect, useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { AslApp } from "./AslApp";
import { GestureApp } from "./GestureApp";

type Mode = "custom" | "asl";

export function GestureHub() {
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    setMode(
      new URLSearchParams(location.search).get("mode") === "asl"
        ? "asl"
        : "custom",
    );
  }, []);

  const change = (m: Mode) => {
    setMode(m);
    const url = new URL(location.href);
    if (m === "asl") url.searchParams.set("mode", "asl");
    else url.searchParams.delete("mode");
    history.replaceState(null, "", url);
  };

  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-4 pt-4">
        <Tabs<Mode>
          items={[
            { id: "custom", label: "Kata saya", icon: Hand },
            { id: "asl", label: "ASL siap pakai", icon: HandHelping },
          ]}
          value={mode ?? "custom"}
          onChange={change}
        />
      </div>
      {mode === "custom" && <GestureApp />}
      {mode === "asl" && <AslApp />}
    </>
  );
}
