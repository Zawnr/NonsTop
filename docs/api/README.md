# API NonsTop

Spesifikasi lengkap: [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1). Contoh response di dalamnya diambil dari server sungguhan.

## Import

**Postman:** Import, pilih file `docs/api/openapi.yaml`. Di opsi import, set *Folder organization* ke **Tags** supaya request dikelompokkan per System, Auth, Push, dan Sync.

**Apidog:** Settings, Import Data, pilih **OpenAPI/Swagger**, lalu pilih file yang sama.

Setelah import, isi base URL:
- Laptop: `http://127.0.0.1:8787` (jalankan `pnpm start` dulu)
- HP atau perangkat lain: alamat Tailscale dari `tailscale serve status`

## Urutan uji

1. `GET /api/health`: tanpa login, harus `{ "ok": true, ... }`.
2. `POST /api/auth/login`: isi password NonsTop. Cookie `nonstop_session` tersimpan otomatis.
3. `GET /api/auth/session`: harus `{ "authenticated": true }`.
4. `POST /api/sync/push`: pakai contoh **createPage**. Ganti angka 13 digit di `hlc` dengan waktu sekarang dalam milidetik (Postman: `Date.now()` di console, atau https://currentmillis.com).
5. `GET /api/sync/pull?since=0`: halaman tadi muncul di `changes`. Buka NonsTop di browser, halaman yang sama ada di sidebar setelah sinkron.
6. `POST /api/auth/logout`, lalu ulangi langkah 3: harus `{ "authenticated": false }`.

## Hal yang sering bikin gagal

| Gejala | Penyebab |
|---|---|
| `403 Forbidden` (teks) pada POST | Header `Content-Type: application/json` tidak ada. Perlindungan CSRF menolaknya. |
| `401 {"error":"unauthorized"}` | Belum login, cookie tidak terkirim, atau sesi kedaluwarsa. |
| `429 too_many_attempts` | 10 password salah dalam 15 menit. Tunggu, atau restart server. |
| `opId` muncul di `rejected` | Entity atau field tidak dikenal, nilai salah tipe, atau `hlc` lebih dari 1 hari di depan jam server. |
| Edit tidak berubah di pull | `hlc` lebih tua dari nilai yang sudah ada. Naikkan angka milidetiknya. |
| Push dengan `opId` lama tidak berefek | Disengaja: push idempoten per `opId`. Pakai `opId` baru tiap operasi. |

## Catatan

- Data yang di-push lewat Postman masuk ke data NonsTop yang sama dengan yang kamu pakai. Untuk uji coba, pakai id dan judul yang mudah dikenali, lalu hapus lewat aplikasi (Trash, Hapus permanen).
- Endpoint `push/subscribe` biasanya dipanggil browser. Uji manualnya hanya berguna untuk melihat validasi, karena endpoint palsu tidak akan menerima notifikasi.
