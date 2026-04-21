# AlmaTrace

AlmaTrace adalah dashboard pencarian alumni dan enrichment kontak publik yang dibangun dengan Next.js 14, TypeScript, Tailwind CSS, dan Playwright lokal. Aplikasi ini menampilkan hasil akademik dari sumber data eksternal, lalu melakukan pencarian lanjutan secara manual per kartu untuk menemukan profil publik, email publik, dan alamat profesional yang relevan.

## Identitas Tugas

- Mata kuliah: Rekayasa Kebutuhan
- Bentuk tugas: Daily Project 4
- Institusi: Universitas Muhammadiyah Malang
- Nama: WIJI FIKO TEREN
- NIM: 202310370311437

## Repository dan Akses Demo

- Repository open source: [github.com/fiko942/rkeb-dp4](https://github.com/fiko942/rkeb-dp4)
- Domain publik: [rkeb-dp4.streampeg.com](https://rkeb-dp4.streampeg.com)
- PIN demo: `085213`

## Fitur Utama

- Pencarian alumni berbasis data eksternal dengan cache berlapis.
- PIN gate untuk membatasi akses dashboard.
- Enrichment kontak dan profil dilakukan manual per kartu untuk mengurangi request yang tidak perlu.
- Discovery publik berbasis Playwright lokal, tanpa Google CSE dan tanpa Brave Search.
- Verifikasi high-precision untuk menampilkan hanya:
  - email publik yang benar-benar ditemukan,
  - alamat profesional atau alamat publik yang relevan,
  - direct profile URL untuk GitHub, LinkedIn, Instagram, X, dan WhatsApp bila tersedia.
- Server-side JSON cache untuk hasil search, discovery, dan enrichment.

## Arsitektur Singkat

Alur kerja enrichment:

1. Pengguna mencari alumni pada dashboard.
2. Data akademik diambil dari provider PDDIKTI publik dan disimpan ke cache.
3. Saat tombol `Cari Kontak & Profil` ditekan, server menjalankan Playwright lokal.
4. Browser melakukan pencarian publik headless atau headful sesuai platform.
5. Top result yang relevan dibuka satu per satu.
6. Sistem mengekstrak direct profile link, email publik, dan alamat publik-profesional.
7. Hasil yang lolos validasi disimpan ke cache enrichment.

## Perilaku Browser Lokal

- macOS:
  - default browser Playwright akan tampil sebagai browser biasa
  - default channel adalah `chrome`
  - bila channel Chrome gagal dibuka, sistem akan fallback ke Chromium
- Linux:
  - default berjalan `headless`
  - default channel adalah `chromium`

Perilaku ini bisa dioverride lewat environment variable bila diperlukan.

## Menjalankan Proyek

### 1. Install dependensi

```bash
npm install
```

### 2. Install browser Playwright

```bash
npx playwright install chromium
```

Jika ingin memakai Google Chrome pada macOS, pastikan Chrome sudah terpasang di sistem.

### 3. Siapkan environment

Salin contoh environment:

```bash
cp .env.example .env.local
```

Variabel penting:

- `ALMATRACE_PIN`
- `ALMATRACE_AUTH_SECRET`
- `ALMATRACE_DATA_MODE`
- `LOCAL_BROWSER_MAX_WORKERS`
- `LOCAL_BROWSER_IDLE_MS`
- `LOCAL_BROWSER_HEADLESS`
- `PLAYWRIGHT_BROWSER_CHANNEL`
- `PLAYWRIGHT_EXECUTABLE_PATH`
- `PLAYWRIGHT_LAUNCH_TIMEOUT_MS`
- `LOCAL_BROWSER_PROFILE_BASE_DIR`

Secara default, profile Playwright lokal akan disimpan di:

```bash
./profile-userdata
```

Folder ini dipakai sebagai direktori runtime browser lokal dan tidak ikut dikomit ke repository.

### 4. Jalankan mode development

```bash
npm run dev
```

### 5. Build production

```bash
npm run build
npm run start
```

## Pengujian

Menjalankan lint:

```bash
npm run lint
```

Menjalankan unit test:

```bash
npm test
```

Menjalankan end-to-end test:

```bash
npm run test:e2e
```

## Struktur Direktori Penting

- `src/app/dashboard/page.tsx`
- `src/components/DashboardClient.tsx`
- `src/components/ResultCard.tsx`
- `src/lib/data-service.ts`
- `src/lib/enrichment-service.ts`
- `src/lib/playwright-local-pool.ts`
- `src/app/api/alumni/search/route.ts`
- `src/app/api/enrichment/route.ts`

## Catatan Implementasi

- Hasil enrichment tidak dibuat secara prediktif.
- Jika email, alamat, atau akun sosial tidak ditemukan secara valid, data tersebut tidak akan ditampilkan.
- Cache discovery dan enrichment sudah dipisahkan agar request ulang lebih efisien.
- Log error Playwright dicetak di server agar penyebab kegagalan pencarian dapat ditelusuri dengan jelas.

## Lisensi

Proyek ini dirilis dengan lisensi MIT. Lihat file [LICENSE](./LICENSE) untuk detail lengkap.
