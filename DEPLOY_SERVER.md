# Deploy Server AlmaTrace

Panduan ini berlaku untuk paket rilis hasil `npm run package:server`.

## Isi Paket

File zip rilis berisi:

- artefak build `.next`
- folder `data`
- `package.json`
- `package-lock.json`
- `next.config.mjs`
- `.env.example`
- `README.md`
- `LICENSE`

## Langkah Deploy di Server

### 1. Upload dan ekstrak zip

Contoh:

```bash
unzip almatrace-server-59620.zip
cd almatrace-server
```

### 2. Install dependency production

```bash
npm ci --omit=dev
```

### 3. Siapkan environment

```bash
cp .env.example .env.local
```

Lalu isi minimal:

- `ALMATRACE_PIN`
- `ALMATRACE_AUTH_SECRET`
- `ALMATRACE_DATA_MODE`

## 4. Install browser Playwright untuk Linux

Karena enrichment berjalan memakai browser lokal, server Linux perlu Chromium Playwright.

```bash
npx playwright install chromium
```

Jika server masih kekurangan dependency sistem, gunakan:

```bash
npx playwright install --with-deps chromium
```

## 5. Jalankan aplikasi

Port start sudah dikunci di `59620`.

```bash
npm run start
```

## Catatan

- Pada macOS, Playwright default akan tampil sebagai browser biasa.
- Pada Linux, Playwright default berjalan headless.
- Jangan upload `.env.local` dari mesin lokal bila berisi secret pengembangan.
