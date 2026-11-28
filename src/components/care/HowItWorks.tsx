"use client";
// Animated explainer of the core loop, shown on the sign-in screen (judges, new nurses, families).
// It is a faithful picture of the real pipeline in src/lib/rehab: the phone on the arm measures
// tilt against gravity -> the angle is compared with the limit the THERAPIST set -> past the
// limit (held for the debounce time) the phone speaks a cue and pauses -> the nurse sees it.
// The numbers are an ILLUSTRATIVE example, labelled as such (AGENTS.md: no invented thresholds).
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const LIMIT = 100; // illustrative only
const CYCLE = [20, 60, 90, 112, 112, 60, 20]; // one rep that goes past the example limit
const STEP_MS = 700;

const STEPS = [
  { t: "HP di lengan", d: "Sensor gerak HP mengukur sudut lengan" },
  { t: "Batas dari terapis", d: "Dibandingkan dengan batas per pasien" },
  { t: "Suara + jeda", d: "Lewat batas: HP bicara dan latihan dijeda" },
  { t: "Perawat tahu", d: "Tercatat dan tampil di dashboard" },
];

export function HowItWorks() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((x) => (x + 1) % CYCLE.length), STEP_MS);
    return () => clearInterval(id);
  }, [reduce]);
  const angle = reduce ? 90 : CYCLE[i];
  const over = angle > LIMIT;
  const step = over ? 3 : angle >= 60 ? 1 : 0;

  // Arm from the shoulder at (60,70); 0° = hanging down, 90° = forward (to the right), 180° =
  // straight up. Same convention as rotating the arm group by -angle (SVG y points down).
  const arm = (a: number, r: number) => ({
    x: 60 + r * Math.sin((a * Math.PI) / 180),
    y: 70 + r * Math.cos((a * Math.PI) / 180),
  });
  const limitEnd = arm(LIMIT, 52);
  const armEnd = arm(angle, 46);
  const phone = arm(angle, 30);
  const startEnd = arm(0, 52);

  return (
    <figure className="rounded-(--radius-card) bg-surface p-4 shadow-(--shadow-card)">
      <figcaption className="mb-3 text-base font-semibold text-muted">
        Cara kerja Rehat
      </figcaption>
      <div className="flex items-center gap-4">
        <svg
          viewBox="0 0 120 130"
          className="w-28 shrink-0"
          role="img"
          aria-label={`Contoh: sudut lengan ${angle} derajat, batas contoh ${LIMIT} derajat`}
        >
          {/* allowed zone */}
          <path
            d={`M60,70 L${startEnd.x},${startEnd.y} A52,52 0 0,0 ${limitEnd.x},${limitEnd.y} Z`}
            fill="var(--color-success-soft)"
          />
          <line
            x1="60"
            y1="70"
            x2={limitEnd.x}
            y2={limitEnd.y}
            stroke="var(--color-danger)"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          {/* body */}
          <circle cx="60" cy="40" r="10" fill="var(--color-border)" />
          <rect
            x="52"
            y="52"
            width="16"
            height="50"
            rx="6"
            fill="var(--color-border)"
          />
          {/* arm + phone: endpoints animated directly (SVG transform-origin is unreliable) */}
          <motion.line
            x1="60"
            y1="70"
            animate={{ x2: armEnd.x, y2: armEnd.y }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
            stroke={over ? "var(--color-danger)" : "var(--color-primary)"}
            strokeWidth="8"
            strokeLinecap="round"
          />
          <motion.circle
            r="5"
            animate={{ cx: phone.x, cy: phone.y }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
            fill="var(--color-text)"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <div
            className={`text-4xl font-semibold tabular-nums ${over ? "text-danger" : ""}`}
          >
            {angle}°
          </div>
          <div className="text-sm text-muted">
            batas contoh {LIMIT}° (diatur terapis)
          </div>
          <motion.div
            key={over ? "over" : "ok"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-sm font-medium ${
              over
                ? "bg-danger-soft text-danger"
                : "bg-success-soft text-success"
            }`}
          >
            {over ? '"Turunkan sedikit lengannya." Dijeda' : "Dalam batas"}
          </motion.div>
        </div>
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, k) => {
          const active = k === step || (over && k === 2);
          return (
            <motion.li
              key={s.t}
              animate={{
                scale: active ? 1.02 : 1,
                opacity: active ? 1 : 0.6,
              }}
              transition={{ duration: 0.2 }}
              className={`rounded-(--radius-control) p-2 ${active ? "bg-primary-soft" : "bg-surface-2"}`}
            >
              <div className="text-sm font-semibold">
                {k + 1}. {s.t}
              </div>
              <div className="text-xs text-muted">{s.d}</div>
            </motion.li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted">
        Angka di animasi hanya contoh. Batas sebenarnya ditetapkan terapis untuk
        tiap pasien.
      </p>
    </figure>
  );
}
