# Cocok (versi Vercel)

Sama seperti versi lokal (scraping JobStreet + AI matching pakai CV), tapi
distruktur ulang jadi Vercel Serverless Functions supaya bisa langsung
di-deploy tanpa server sendiri.

## Struktur

```
api/
  search.js    # POST — fan-out scraping ke sumber yang dipilih
  sources.js   # GET  — daftar sumber lowongan yang tersedia
  match.js     # POST — skor kecocokan CV vs lowongan (Gemini API)
  health.js    # GET  — cek status env var
lib/
  matcher.js       # logic pemanggilan Gemini API
  sources/
    index.js       # registry semua sumber
    jobstreet.js   # Puppeteer + @sparticuz/chromium (client-side rendered)
    hennge.js      # cheerio, HTML statis
    glints.js      # cheerio, HTML statis
    mercari.js     # Greenhouse Job Board API publik (JSON, no scraping)
public/        # frontend statis (HTML/CSS/JS), otomatis di-serve Vercel
```

## Sumber lowongan

- **JobStreet** — Puppeteer serverless, rawan diblokir (lihat catatan di bawah).
- **HENNGE** — HTML server-rendered, scraping ringan tanpa headless browser.
- **Glints** — HTML server-rendered, keyword difilter di sisi server (bukan lewat query string).
- **Mercari** — pakai Greenhouse Job Board API publik (`boards-api.greenhouse.io`), bukan scraping HTML — paling stabil dari semua sumber.
- **LinkedIn & Indeed** — sengaja tidak diotomasi (ToS ketat, proteksi bot berat). Pakai tab "Tempel Manual".

Pilih sumber lewat checkbox di UI sebelum klik "Cari lowongan".

## Deploy

**Opsi A — lewat dashboard (tanpa CLI):**
1. Push folder ini ke repo GitHub baru.
2. Buka vercel.com → **New Project** → import repo tersebut.
3. Di **Settings → Environment Variables**, tambahkan:
   - `GEMINI_API_KEY` = API key gratis dari aistudio.google.com/apikey
4. Deploy.

**Opsi B — lewat CLI:**
```bash
npm install -g vercel
cd cocok-vercel
vercel login
vercel env add GEMINI_API_KEY   # tempel API key kamu
vercel --prod
```

## Coba lokal dulu sebelum deploy (opsional)

```bash
npm install -g vercel
vercel dev
```

Ini menjalankan emulasi serverless functions Vercel di `localhost:3000` —
cara paling akurat untuk tes sebelum deploy beneran.

## ⚠️ Yang perlu kamu tahu soal scraping di Vercel

Ini bagian paling rawan, tolong dibaca:

1. **Batas waktu function.** Plan Hobby (gratis) defaultnya cuma kasih
   10 detik per request. `vercel.json` di sini sudah di-set `maxDuration: 60`
   untuk `/api/search` — tapi kalau deploy gagal dengan error
   `invalid maxDuration`, itu tandanya akun kamu belum bisa pakai durasi
   segitu. Solusinya: aktifkan **Fluid Compute** di Project Settings
   (tersedia di plan Hobby, menaikkan batas jadi lebih tinggi), atau turunkan
   nilai `maxDuration` ke 10.

2. **IP Vercel lebih gampang dicurigai bot.** Request scraping datang dari
   IP data center, bukan IP rumahan — jadi kemungkinan diblokir JobStreet
   **lebih tinggi** dibanding kalau kamu jalanin scraper-nya di komputer
   sendiri (lihat versi lokal di folder `backend/`).

3. **Cold start Chromium makan waktu.** Invocation pertama setelah idle
   biasanya beberapa detik lebih lambat karena Chromium harus di-load ulang.

4. **Kalau scraping gagal terus di Vercel** — ini realistis bisa terjadi —
   pakai tab **"Tempel Manual"** di UI. Fitur itu tidak butuh scraping sama
   sekali, cuma butuh `/api/match` yang jauh lebih ringan dan reliable di
   serverless. Buka JobStreet manual di browser, copy-paste lowongan yang
   kamu incar, dan AI matching tetap jalan normal.

Kalau kamu mau scraping yang lebih andal, menjalankan versi lokal (folder
`backend/` di proyek sebelumnya, `npm start` di komputer sendiri) akan lebih
stabil daripada di serverless — tidak ada batas waktu, dan IP-nya IP rumahan
kamu sendiri.

## Environment Variables

| Nama | Wajib | Keterangan |
|---|---|---|
| `GEMINI_API_KEY` | Ya | Untuk fitur AI matching. Set di Vercel dashboard, bukan file `.env` (file itu hanya untuk `vercel dev` lokal via `.env.local`) |
