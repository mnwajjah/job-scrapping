/**
 * lib/auto-apply/ai-navigator.js — Gemini AI untuk navigasi form lamaran.
 *
 * Gemini membaca HTML mentah dan memutuskan:
 * - Mana tombol "Apply" di halaman job
 * - Field mana yang perlu diisi dan dengan nilai apa
 * - Apakah ada CAPTCHA
 * - Apakah ada step berikutnya (multi-page form)
 */

const { CV_TEXT } = require("../cv");

const MODEL = "gemini-3.5-flash";

let GoogleGenAI;
let ai;
async function getAI() {
  if (!GoogleGenAI) {
    const mod = await import("@google/genai");
    GoogleGenAI = mod.GoogleGenAI;
  }
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

// ── CV data terstruktur untuk form filling ──────────────────────────────────
const CV_DATA = {
  fullName: "Muhammad Nur Wajjah",
  firstName: "Muhammad",
  lastName: "Wajjah",
  email: "mwajjah@gmail.com",
  phone: "",
  location: "Batam, Indonesia",
  city: "Batam",
  country: "Indonesia",
  linkedIn: "",
  github: "",
  portfolio: "",
  currentTitle: "Executive Fullstack Developer",
  yearsExperience: "3",
  education: "S1 Informatics Engineering",
  university: "High School of Technology Indonesia",
  visaStatus: "Need sponsorship",
  languages: "Indonesian (native), English (TOEFL 627)",
  salaryExpectation: "",
  availableStart: "Immediately",
  noticePeriod: "2 weeks",
};

/**
 * Cari tombol/link Apply di halaman job listing.
 * @param {string} html - HTML halaman (sudah disanitasi, max ~12K chars)
 * @returns {Promise<{selector: string, confidence: number, notes: string}>}
 */
async function findApplyButton(html) {
  const prompt = `Kamu adalah browser automation agent. Dari HTML berikut, identifikasi tombol atau link untuk APPLY/MELAMAR ke lowongan ini.

HTML (sebagian):
${html.slice(0, 30000)}

Kembalikan JSON object:
{
  "found": true/false,
  "selector": "CSS selector paling spesifik untuk tombol apply (contoh: a.apply-btn, button#apply, a[href*='apply'])",
  "text": "teks tombol yang terlihat",
  "isExternalLink": true/false (apakah mengarah ke situs lain),
  "href": "URL tujuan jika link (null jika button)",
  "confidence": 0-100,
  "notes": "catatan singkat"
}

Prioritaskan: tombol dengan teks "Apply", "Apply Now", "Submit Application", atau link ke halaman aplikasi.
Jika ada beberapa, pilih yang paling relevan (bukan "Save" atau "Share").`;

  const genAI = await getAI();
  const res = await genAI.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return JSON.parse(res.text);
}

/**
 * Analisis form lamaran dan kembalikan aksi yang perlu dilakukan.
 * @param {string} html - HTML form
 * @param {string} pageUrl - URL halaman saat ini
 * @returns {Promise<{actions: Array, hasNextStep: boolean, hasCaptcha: boolean, confidence: number}>}
 */
async function analyzeForm(html, pageUrl) {
  const prompt = `Kamu adalah browser automation agent yang mengisi form lamaran kerja.

DATA PELAMAR:
${JSON.stringify(CV_DATA, null, 2)}

RINGKASAN CV:
${CV_TEXT.slice(0, 800)}

URL HALAMAN: ${pageUrl}

HTML FORM (sebagian):
${html.slice(0, 35000)}

INSTRUKSI:
1. Identifikasi SEMUA field yang perlu diisi di form ini
2. Untuk setiap field, tentukan CSS selector dan nilai yang tepat dari data pelamar
3. Untuk field textarea/cover letter, tulis cover letter singkat (3-4 kalimat, profesional, dalam bahasa Inggris)
4. Untuk dropdown/select, pilih opsi yang paling cocok
5. Untuk checkbox (terms, agreement), centang
6. Untuk file upload, tandai dengan type "upload"
7. Identifikasi tombol submit/next di akhir

Kembalikan JSON:
{
  "actions": [
    {"type": "fill", "selector": "CSS selector", "value": "nilai", "label": "nama field"},
    {"type": "select", "selector": "CSS selector", "value": "option value", "label": "nama field"},
    {"type": "check", "selector": "CSS selector", "label": "nama field"},
    {"type": "upload", "selector": "CSS selector", "label": "nama field"},
    {"type": "click", "selector": "CSS selector tombol submit/next", "label": "Submit/Next"}
  ],
  "hasNextStep": false,
  "hasCaptcha": false,
  "confidence": 0-100,
  "coverLetter": "cover letter yang sudah digenerate (jika ada field untuk itu)",
  "notes": "catatan tentang form ini"
}

PENTING:
- Gunakan selector yang SPESIFIK (id > name > class > tag)
- Jangan isi field yang sudah pre-filled
- Jika ada CAPTCHA/reCAPTCHA, set hasCaptcha=true
- Jika ada tombol "Next" bukan "Submit", set hasNextStep=true
- confidence rendah (<50) jika form terlalu kompleks atau tidak standar`;

  const genAI = await getAI();
  const res = await genAI.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return JSON.parse(res.text);
}

/**
 * Deteksi apakah halaman saat ini masih bagian dari proses apply
 * atau sudah selesai (confirmation page).
 */
async function detectPageState(html) {
  const prompt = `Analisis HTML ini dan tentukan state halaman:

HTML (sebagian):
${html.slice(0, 15000)}

Kembalikan JSON:
{
  "state": "form" | "confirmation" | "error" | "captcha" | "login_required" | "unknown",
  "message": "penjelasan singkat",
  "hasMoreFields": true/false (apakah ada field yang belum diisi)
}`;

  const genAI = await getAI();
  const res = await genAI.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return JSON.parse(res.text);
}

module.exports = { findApplyButton, analyzeForm, detectPageState, CV_DATA };
