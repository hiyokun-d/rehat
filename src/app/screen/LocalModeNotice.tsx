import { Alert } from "@/components/ui/Alert";

/**
 * /screen without a therapist login. server.mts only upgrades the relay WebSocket for a
 * one-time ticket (POST /api/ws-ticket needs a login), so no phone can reach this screen in this
 * mode: the notice says so instead of leaving an empty live view unexplained.
 */
export function LocalModeNotice() {
  return (
    <Alert tone="info" title="Mode lokal: belum masuk sebagai terapis">
      Sambungan live ke HP butuh login terapis (relay mewajibkan tiket sekali
      pakai). Riwayat yang tersimpan di laptop ini tetap bisa dibuka di tab
      Riwayat. Masuk di sana untuk riwayat dari server dan live dari HP.
    </Alert>
  );
}
