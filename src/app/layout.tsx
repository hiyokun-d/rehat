import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import { MotionRoot } from "@/components/MotionRoot";
import "./globals.css";

// Downloaded at build time and served from our own server: no request to Google at runtime.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Rehat — prototipe",
  description:
    "Prototipe kelayakan: HP sebagai sensor gerak, laptop sebagai layar.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html>/<body> before React loads.
    <html
      lang="id"
      className={`${poppins.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col font-sans"
        suppressHydrationWarning
      >
        <MotionRoot>{children}</MotionRoot>
      </body>
    </html>
  );
}
