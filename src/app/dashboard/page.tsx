import { redirect } from "next/navigation";

/** Old link. The dashboard is the landing page now. */
export default function DashboardPage() {
  redirect("/");
}
