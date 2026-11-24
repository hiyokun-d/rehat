import { redirect } from "next/navigation";

// The ASL recogniser now lives inside /gesture ("ASL siap pakai").
export default function AslPage() {
  redirect("/gesture?mode=asl");
}
