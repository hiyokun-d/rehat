// Moving history without a laptop: share the JSON file (WhatsApp, email, Drive) through the
// phone's share sheet, or download it. The laptop imports the same file.
import { downloadJson, stamp } from "../sensor/recording";
import { makeExport, type SessionSummary } from "./summary";

export async function shareOrDownload(
  sessions: SessionSummary[],
): Promise<void> {
  const data = makeExport(sessions);
  const name = `rehat-riwayat-${stamp()}.json`;
  const file = new File([JSON.stringify(data)], name, {
    type: "application/json",
  });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Riwayat latihan Rehat" });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // user closed the share sheet
    }
  }
  downloadJson(name, data);
}
