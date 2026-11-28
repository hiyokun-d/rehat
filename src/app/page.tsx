import type { Metadata } from "next";
import { DashboardApp } from "./dashboard/DashboardApp";

export const metadata: Metadata = { title: "Rehat · Dashboard perawat" };

/** Landing page = the nurse dashboard. Patients go to /phone (linked from the sign-in screen). */
export default function Home() {
  return <DashboardApp />;
}
