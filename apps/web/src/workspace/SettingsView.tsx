// Settings: push notifications for this device, and sign out.
import { useState } from 'react';
import { api } from '../api.ts';
import { enablePush, pushSupport } from '../push.ts';

export function SettingsView({ onLogout }: { onLogout: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const support = pushSupport();

  async function run(task: () => Promise<string>) {
    setStatus('…');
    try {
      setStatus(await task());
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Gagal.');
    }
  }

  return (
    <article className="page-view">
      <h1>Pengaturan</h1>

      <section className="card">
        <h2>Notifikasi</h2>
        {support === 'insecure' && <p>Notifikasi butuh HTTPS. Buka NonsTop lewat alamat Tailscale.</p>}
        {support === 'unsupported' && <p>Browser ini tidak mendukung push notification.</p>}
        {support === 'supported' && (
          <div className="row">
            <button onClick={() => run(async () => (await enablePush(), 'Notifikasi aktif di perangkat ini.'))}>
              Aktifkan notifikasi
            </button>
            <button
              className="ghost"
              onClick={() =>
                run(async () => {
                  const r = await api.pushTest();
                  return `Terkirim ke ${r.sent} perangkat${r.failed ? `, gagal ${r.failed}` : ''}.`;
                })
              }
            >
              Kirim tes
            </button>
          </div>
        )}
        {status && <p className="status">{status}</p>}
      </section>

      <section className="card">
        <h2>Akun</h2>
        <p className="muted">Data di perangkat ini tetap tersimpan setelah keluar, dan tersinkron lagi saat login.</p>
        <button className="ghost" onClick={() => api.logout().finally(onLogout)}>
          Keluar
        </button>
      </section>
    </article>
  );
}
