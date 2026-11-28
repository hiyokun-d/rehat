"use client";
// Last-resort error page when the root layout itself fails. It replaces the whole document, so
// no global CSS or fonts load here: styles are inline, light and dark via prefers-color-scheme.
const css = `
:root{color-scheme:light dark;--bg:#f4f6f5;--fg:#14201d;--muted:#55635f;--pri:#0f766e;--dang:#b42318;--dsoft:#fee4e2}
@media (prefers-color-scheme:dark){:root{--bg:#0f1715;--fg:#e6edeb;--muted:#9fb0ab;--pri:#2dd4bf;--dang:#f97066;--dsoft:#3b1512}}
body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.5 system-ui,sans-serif}
main{max-width:28rem;margin:0 auto;min-height:100dvh;display:flex;flex-direction:column;justify-content:center;gap:1rem;padding:2.5rem 1rem}
.code{font-size:3rem;font-weight:600;color:var(--pri)}
p{color:var(--muted);margin:0}
button,a.btn{height:3rem;padding:0 1rem;border-radius:.75rem;border:0;background:var(--pri);color:#fff;font:600 1.1rem system-ui;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.sos{background:var(--dsoft);color:var(--dang);padding:.75rem;border-radius:1rem}
.sos a{color:inherit;font-weight:700}
`;

export default function GlobalError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="id">
      <body>
        <title>Rehat · Terjadi kesalahan</title>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS string, no user input */}
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <main>
          <div className="code">500</div>
          <h1 style={{ margin: 0 }}>Rehat sedang bermasalah</h1>
          <p>
            Latihan yang tersimpan di HP tidak hilang. Coba muat ulang sebentar
            lagi.
          </p>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            <button type="button" onClick={() => retry()}>
              Coba lagi
            </button>
          </div>
          <p className="sos">
            Darurat (wajah mencong, lengan lemah, bicara pelo)?{" "}
            <a href="tel:119">Telepon 119</a>.
          </p>
        </main>
      </body>
    </html>
  );
}
