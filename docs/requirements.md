---
status: approved
versi: 0.2
diperbarui: 2026-11-04
pemilik: user (analis), Claude (penulis)
---
# NonsTop — Requirement

NonsTop adalah workspace pribadi untuk catatan, task, ide, dan proyek. Cara kerjanya seperti Notion: halaman bersarang, database dengan properti custom, dan beberapa tampilan untuk data yang sama. NonsTop menggantikan `03-coding/self-note`.

## 1. Masalah

- User punya banyak ide acak dan topik hidup: kerja, side project, kos, perjalanan, belajar, refleksi. User butuh satu tempat untuk menulis bebas, tetapi tetap rapi dan bisa dilacak.
- Alat sekarang, notes vivo Office Kit, kurang fleksibel. Tidak ada halaman bersarang, database, kanban, dan pelacakan progres.
- Notion memenuhi kebutuhan, tetapi user ingin alat gratis yang dia miliki dan bisa dikembangkan sendiri.
- Percobaan pertama, `self-note`, gagal di semua sisi: fitur salah, alur ribet, UI jelek, lambat, tidak selesai, dan tidak terpakai. Penyebabnya plan yang lemah, bukan stack.

## 2. Pengguna dan bukti kebutuhan

- Satu pengguna: pemilik. User menjadi project manager sekaligus eksekutor untuk dirinya sendiri, dibantu AI.
- Laptop: perangkat utama untuk kerja dan menulis detail.
- HP (Android, vivo): catatan cepat, cek progres, update kecil.
- Bukti: user menulis catatan tiap hari di Office Kit, dan sudah pernah mencoba membangun alat ini sekali.
- Menjual produk bukan tujuan saat ini.

## 3. Solusi

Web app yang di-install sebagai PWA di laptop dan HP. Berjalan di laptop WSL dulu, lalu pindah ke home server.

Model inti:

- Semua hal adalah **halaman**. Halaman berisi **blok** (teks, heading, checklist, gambar, dan lain-lain) dan bisa berisi halaman anak tanpa batas kedalaman.
- **Database** adalah kumpulan halaman yang berbagi **properti** (field). User yang menentukan propertinya.
- **View** menampilkan satu database sebagai tabel, board, list, atau layout lain. Tiap view punya filter, sort, dan group sendiri.
- Tiap baris database adalah halaman penuh. Jadi task atau ticket selalu punya halaman detail.
- Database bisa diletakkan di halaman mana pun. Jadi tabel, board, dan catatan bisa saling bersarang.

Dua level pelacakan task:

- **Sederhana:** blok checklist di dalam halaman. Statusnya selesai atau belum.
- **Lanjutan:** baris database dengan properti status, tampil di board kanban.

## 4. Fungsi

Prioritas: **M** = wajib di MVP 1. **S** = sebaiknya ada, setelah MVP 1 dipakai harian. **C** = bisa nanti.

### 4.1 Halaman dan blok
| ID | Fungsi | Prio |
|---|---|---|
| F-01 | Buat, ganti nama, pindah, dan hapus halaman. Halaman bersarang tanpa batas kedalaman. | M |
| F-02 | Pohon halaman di sidebar: buka dan tutup cabang, drag untuk mengurutkan dan memindahkan. | M |
| F-03 | Editor blok dengan menu slash: paragraf, heading 1 sampai 3, bullet list, numbered list, checklist, toggle, quote, callout, code, divider. | M |
| F-04 | Drag blok untuk mengurutkan. Indent blok untuk membuat sarang. | M |
| F-05 | Blok gambar dan file, disimpan di server. | S |
| F-06 | Link ke halaman lain dari dalam teks (`@` atau `[[`), dengan backlink di halaman tujuan. | S |
| F-07 | Ikon dan cover halaman. | C |
| F-08 | Favorit di sidebar. | M |
| F-09 | Trash dengan restore. Hapus permanen hanya dari trash. | M |

### 4.2 Database dan properti
| ID | Fungsi | Prio |
|---|---|---|
| F-10 | Buat database sebagai halaman penuh atau inline di dalam halaman. | M |
| F-11 | Tipe properti: text, number, select, multi-select, status, date (dengan tanggal akhir opsional), checkbox, URL, relation. | M |
| F-12 | Tipe properti: created time, edited time, rollup, formula. | S |
| F-13 | Tambah, ganti nama, urutkan, sembunyikan, dan hapus properti. Edit opsi select dan status beserta warnanya. | M |
| F-14 | Tiap baris terbuka sebagai halaman penuh: properti di atas, blok di bawah. | M |
| F-15 | Relation antar database dua arah, contohnya task ke epic atau ide ke proyek. | M |

### 4.3 View
| ID | Fungsi | Prio |
|---|---|---|
| F-20 | View tabel dengan edit langsung di sel. | M |
| F-21 | View board (kanban), dikelompokkan per status atau select. Drag kartu antar kolom. | M |
| F-22 | View list. | M |
| F-23 | Banyak view per database. Tiap view punya filter, sort, group, dan properti tampil sendiri. | M |
| F-24 | View kalender berdasarkan properti date. | S |
| F-25 | View timeline untuk roadmap. | S |
| F-26 | View chart, dipakai untuk burndown (lihat F-42). | S |

### 4.4 Template dan kustomisasi
| ID | Fungsi | Prio |
|---|---|---|
| F-30 | Template halaman. Contoh: kanvas ide (ide besar, pain point, flow, success metric) dan rencana trip (rute, checklist barang, todo). | M |
| F-31 | Template baris database, contohnya layout ticket default. | M |
| F-32 | Duplikat halaman atau database beserta strukturnya. | M |
| F-33 | Paket awal saat pertama jalan: database Ide, Task, Jurnal, Belajar, Roadmap. Semua bisa diubah. | S |
| F-34 | Tema terang dan gelap. | S |

### 4.5 Pelacakan kerja (scrum pribadi)
Semua fungsi ini berjalan di atas model database generik. Hanya burndown yang butuh kode khusus.
| ID | Fungsi | Prio |
|---|---|---|
| F-40 | Database ticket dengan status, story point (number), epic (relation), dan view backlog (filter). | M |
| F-41 | Ubah ide atau item checklist menjadi ticket, dengan link balik ke sumbernya. | M |
| F-42 | Burndown chart per sprint, dari story point dan tanggal perubahan status. Hanya untuk proyek yang memakai sprint. | S |
| F-43 | Sprint sebagai database dengan tanggal mulai dan selesai, berelasi ke ticket. Sprint opsional per proyek, dan panjangnya bebas. Proyek tanpa sprint cukup memakai backlog. | S |

### 4.6 Tangkap, cari, pengingat
| ID | Fungsi | Prio |
|---|---|---|
| F-50 | Catatan cepat di HP: satu tap membuka catatan baru di halaman Inbox. | M |
| F-51 | Pencarian full-text di judul dan isi halaman. | M |
| F-52 | Pengingat deadline: push notification di HP dan laptop untuk properti date, pada jam yang user atur. Tidak ada daftar jatuh tempo khusus di dalam app. | M |
| F-53 | Claude merapikan ide saat diminta, lewat Claude Code yang membaca dan menulis data NonsTop. Tidak ada API key di dalam app. | C |

### 4.7 Offline dan sinkronisasi
| ID | Fungsi | Prio |
|---|---|---|
| F-60 | PWA bisa di-install di Android dan desktop. | M |
| F-61 | Baca dan edit saat offline. Perubahan disimpan lokal dulu. | M |
| F-62 | Sinkron otomatis saat server bisa dijangkau lagi. Status sinkron tampil: tersinkron, menunggu, atau error. | M |
| F-63 | Aturan konflik untuk satu user di dua perangkat: edit terakhir menang per blok dan per properti. Tidak ada data yang hilang diam-diam. | M |

### 4.8 Akun dan data
| ID | Fungsi | Prio |
|---|---|---|
| F-70 | Login untuk satu user. Tidak ada halaman daftar. | M |
| F-71 | Backup harian otomatis untuk database dan file. Restore dengan satu perintah. | M |
| F-72 | Ekspor satu halaman atau seluruh workspace ke Markdown. | S |
| F-73 | Impor catatan lama dari file `.txt` ekspor Office Kit. Dikerjakan hanya kalau user memberi filenya. | C |

## 5. Kebutuhan non-fungsional
| ID | Kebutuhan |
|---|---|
| N-01 | Cepat: halaman terbuka di bawah 300 ms dari cache lokal. Mengetik tanpa lag. |
| N-02 | Layout mobile-first untuk layar catatan cepat dan board. Layout laptop untuk menulis. |
| N-03 | HP bisa menjangkau server di laptop dari luar jaringan rumah lewat Tailscale. Koneksi memakai HTTPS (sertifikat dari Tailscale), karena PWA dan push notification membutuhkannya. |
| N-04 | Jalan dengan satu perintah di WSL. Pindah ke home server tanpa ubah kode. |
| N-05 | Tidak butuh layanan berbayar untuk berjalan. |
| N-06 | Data tetap di mesin milik user. |

## 6. Di luar scope (MVP 1)
- Multi-user, berbagi, komentar, hak akses.
- Publikasi halaman ke publik.
- Integrasi messenger (WhatsApp, Telegram).
- Jualan, billing, pendaftaran user.
- App native Android atau iOS.
- Edit kolaboratif real-time.
- Semua fungsi berprioritas S atau C di atas.

## 7. Selesai jika (MVP 1)
- Semua fungsi M jalan di laptop dan HP Android. Buktinya test otomatis dan uji di perangkat nyata.
- User memakai NonsTop tiap hari selama 14 hari berturut-turut, dan tidak kembali ke Office Kit untuk catatan baru.
- Edit offline di HP muncul di laptop setelah tersambung lagi, tanpa data hilang.
- Pengingat deadline sampai di HP pada jam yang diatur.
- Uji restore backup mengembalikan semua data.

## 8. Jenis produk
Web app (PWA), self-hosted: laptop WSL dulu, home server nanti.

## 9. Keputusan (jawaban Q-01 sampai Q-07, 2026-11-04)
| ID | Keputusan |
|---|---|
| Q-01 | Bagian 7 disetujui. Inti selesai: semua fungsi M jalan. |
| Q-02 | Pembagian M/S/C disetujui. |
| Q-03 | Sprint opsional, sesuai kebutuhan tiap proyek (F-42, F-43). |
| Q-04 | Merapikan ide lewat Claude Code, tanpa API key di app (F-53). |
| Q-05 | Akses HP memakai Tailscale (N-03). |
| Q-06 | Pengingat cukup push notification (F-52). |
| Q-07 | Impor dari file `.txt`, kalau user memberikannya (F-73). |
