// QR code drawn as SVG in React (no innerHTML). Generated locally: no network, no service.
import qrcode from "qrcode-generator";
import { useMemo } from "react";

export function QrCode({
  value,
  size = 176,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, "M"); // type 0 = smallest version that fits; "M" survives ~15% damage/glare
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, path: d };
  }, [value]);

  // 2-module quiet zone; black on white regardless of theme, scanners need the contrast.
  return (
    <svg
      viewBox={`-2 -2 ${n + 4} ${n + 4}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className="rounded-lg bg-white"
    >
      <path d={path} fill="#000" shapeRendering="crispEdges" />
    </svg>
  );
}
