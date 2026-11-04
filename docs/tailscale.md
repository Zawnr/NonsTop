# Akses NonsTop dari HP lewat Tailscale

NonsTop jalan di laptop (WSL) dan hanya mendengarkan `127.0.0.1:8787`. Tailscale membuat jaringan privat antara laptop dan HP, lalu `tailscale serve` membuka NonsTop di alamat HTTPS yang hanya bisa dijangkau perangkat milikmu.

HTTPS wajib, karena Android hanya mengizinkan install PWA dan push notification lewat HTTPS.

## Sekali saja

1. Buat akun di https://login.tailscale.com (gratis untuk pemakaian pribadi).
2. Di admin console, buka **DNS**. Pastikan **MagicDNS** aktif, lalu aktifkan **HTTPS Certificates**.
3. Di WSL (Tailscale sudah terpasang lewat snap):
   ```bash
   sudo tailscale up
   ```
   Buka link yang muncul, lalu login.
4. Di HP Android: install app **Tailscale** dari Play Store, login dengan akun yang sama, lalu nyalakan.
5. Di folder NonsTop, buat `.env` (password login dan kunci VAPID untuk push):
   ```bash
   pnpm configure
   ```
   Tanpa langkah ini `pnpm start` berhenti dengan pesan `Missing NONSTOP_PASSWORD_HASH ...`.

## Tiap kali NonsTop dijalankan

```bash
pnpm start                          # terminal 1: build web lalu jalankan server
sudo tailscale serve --bg 8787      # sekali saja; tetap aktif setelah restart
tailscale serve status              # menampilkan alamat https://<nama-laptop>.<tailnet>.ts.net
```

`--bg` membuat konfigurasi serve tersimpan, jadi langkah kedua cukup sekali.

## Di HP

1. Buka alamat `https://<nama-laptop>.<tailnet>.ts.net` di Chrome.
2. Login dengan password NonsTop.
3. Menu Chrome, pilih **Install app** (atau **Tambahkan ke layar utama**).
4. Buka NonsTop dari ikon di layar utama, tekan **Aktifkan notifikasi**, lalu **Kirim tes**.

## Kalau bermasalah

| Gejala | Cek |
|---|---|
| HP tidak bisa membuka alamat | App Tailscale di HP menyala? `tailscale status` di WSL menampilkan HP? |
| Sertifikat error | HTTPS Certificates sudah aktif di admin console? Tunggu 1 menit setelah akses pertama. |
| `502 Bad Gateway` | Server NonsTop belum jalan. Jalankan `pnpm start`. |
| Tombol notifikasi tidak muncul | Halaman dibuka lewat `http://`, bukan alamat HTTPS Tailscale. |
| Notifikasi tes tidak sampai | Izin notifikasi Chrome dan app NonsTop di pengaturan Android; mode hemat baterai vivo bisa menahan notifikasi. |

## Catatan

- Laptop mati atau tidur berarti HP tidak bisa sinkron dan pengingat tidak terkirim. Ini diterima untuk MVP 1 dan selesai saat pindah ke home server.
- Jangan pakai `tailscale funnel`. Funnel membuka NonsTop ke internet publik.
