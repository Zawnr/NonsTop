# Plan log (task ukuran S)

## 2026-11-04 — Dokumentasi API untuk Postman/Apidog
- Status: `done`. Ukuran: S. Diminta user di tengah Sprint 1.
- Goal: semua endpoint server terdokumentasi beserta request dan response, dan bisa langsung di-import ke Postman atau Apidog.
- Hasil: `docs/api/openapi.yaml` (OpenAPI 3.1) dan `docs/api/README.md` (cara import dan urutan uji).
- Done when: spesifikasi lolos validator OpenAPI, dan contoh response diambil dari server sungguhan, bukan ditulis tangan.

## 2026-11-05 — Perbaikan hasil uji HP Sprint 3
- Status: `done` (user: "fix 1 dan 3"; uji HP putaran 2 lulus). Ukuran: S. Branch `feat/sprint-3-database`.
- Goal: (1) "+ Baris baru" di tabel menambah baris di tempat dan langsung membuka edit judul, tanpa pindah halaman. (2) Keyboard HP tidak turun naik saat menekan "+ Opsi", dan alur keyboard lain di popover dan sel tabel terasa wajar. (3) Database inline rapi di HP: tanpa sorotan biru blok, warna kolom seragam, selebar layar, kolom Judul tidak sesak.
- Done when: typecheck, lint, unit, dan e2e lulus (termasuk viewport HP), lalu uji HP user lulus.
