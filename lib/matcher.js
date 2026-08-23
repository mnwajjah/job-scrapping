/**
 * lib/matcher.js — AI matching probabilistik via Gemini 2.5 Flash.
 * Menghitung peluang lolos interview dengan breakdown:
 *   - Tech stack match (required vs nice-to-have)
 *   - Experience relevance
 *   - Faktor "mau belajar" untuk tech yang belum ada
 *
 * NOTE: @google/genai adalah ESM package — pakai dynamic import()
 */

const MODEL = "gemini-3.6-flash";

// Response schema definition (built per-call to avoid top-level ESM issue)
const SCHEMA = {
  type: "object",
  properties: {
    score:          { type: "integer" },
    chanceLabel:    { type: "string" },
    recommendation: { type: "string" },
    reasoning:      { type: "string" },
    techStackMatch: {
      type: "object",
      properties: {
        matched:  { type: "array", items: { type: "string" } },
        canLearn: { type: "array", items: { type: "string" } },
        missing:  { type: "array", items: { type: "string" } },
        score:    { type: "integer" },
      },
      required: ["matched", "canLearn", "missing", "score"],
    },
    experienceMatch: {
      type: "object",
      properties: {
        score: { type: "integer" },
        note:  { type: "string" },
      },
      required: ["score", "note"],
    },
    strengths: { type: "array", items: { type: "string" } },
    gaps:      { type: "array", items: { type: "string" } },
  },
  required: ["score", "chanceLabel", "recommendation", "reasoning", "techStackMatch", "experienceMatch", "strengths", "gaps"],
};

function buildPrompt({ cvText, job }) {
  return `Kamu adalah ahli rekrutmen senior. Analisis peluang NYATA kandidat berikut lolos interview/proses rekrutmen untuk lowongan ini.

=== CV KANDIDAT ===
${cvText}

=== LOWONGAN ===
Judul: ${job.title}
Perusahaan: ${job.company || "-"}
Lokasi: ${job.location || "-"}
Gaji: ${job.salary || "tidak disebutkan"}
Deskripsi: ${job.description || "(tidak ada deskripsi detail)"}

=== INSTRUKSI PENILAIAN ===
Hitung skor peluang lolos (0-100) dengan metodologi berikut:

1. **Tech Stack Match (bobot 40%)**
   - Identifikasi semua tech yang REQUIRED dan NICE-TO-HAVE dari lowongan
   - Tech yang "nice-to-have" atau "preferred" → JANGAN kurangi banyak kalau tidak ada
   - Kandidat punya PHP/JS/Node.js/React → ini TRANSFERABLE skill yang kuat
   - Kalau tidak ada tech tapi bisa dipelajari dalam <3 bulan → masuk "canLearn", kurangi sedikit saja
   - Tech kritikal yang benar-benar tidak ada dan tidak transferable → masuk "missing"

2. **Experience Match (bobot 30%)**
   - Lama pengalaman vs requirement
   - Relevansi domain (web dev, backend, fullstack, dll)
   - Leadership/seniority level match

3. **Faktor Bonus / Probabilistik (bobot 30%)**
   - Kandidat pernah deploy production system → +
   - Portfolio project nyata (Payroll & Billing SaaS) → +
   - Kemampuan belajar mandiri (sertifikat Python, R, dll) → +
   - TOEFL 627 untuk job internasional/remote → +
   - GPA 3.26 → netral/slight positive
   - Lokasi Batam: remote-friendly? relokasi? → pertimbangkan

4. **chanceLabel**: "Sangat Tinggi" (≥80), "Tinggi" (65-79), "Sedang" (45-64), "Rendah" (<45)

5. **recommendation**: 
   - "Apply sekarang!" (≥70)
   - "Apply dengan persiapan portfolio" (55-69)
   - "Apply kalau tertarik belajar tech-nya" (40-54)
   - "Lewati dulu" (<40)

Berikan analisis JUJUR dan REALISTIS. Jangan terlalu optimis atau pesimis.`;
}

// Lazy-loaded Gemini client (ESM)
let _genai = null;
async function getClient() {
  if (_genai) return _genai;
  const { GoogleGenAI } = await import("@google/genai");
  _genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _genai;
}

async function scoreJob({ cvText, job }) {
  const client = await getClient();
  const res = await client.models.generateContent({
    model: MODEL,
    contents: buildPrompt({ cvText, job }),
    config: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
    },
  });
  const parsed = JSON.parse(res.text);
  return {
    ...job,
    matchScore:      parsed.score,
    chanceLabel:     parsed.chanceLabel,
    recommendation:  parsed.recommendation,
    reasoning:       parsed.reasoning,
    techStackMatch:  parsed.techStackMatch,
    experienceMatch: parsed.experienceMatch,
    strengths:       parsed.strengths,
    gaps:            parsed.gaps,
  };
}

async function matchJobs({ cvText, jobs }) {
  // Proses serial untuk menghindari rate limit Gemini
  const results = [];
  for (const job of jobs) {
    try {
      const scored = await scoreJob({ cvText, job });
      results.push(scored);
    } catch (err) {
      console.error(`[matcher] gagal score job "${job.title}":`, err.message);
      results.push({
        ...job,
        matchScore: 0,
        chanceLabel: "Error",
        recommendation: "-",
        reasoning: err.message,
        techStackMatch: { matched: [], canLearn: [], missing: [], score: 0 },
        experienceMatch: { score: 0, note: "-" },
        strengths: [],
        gaps: [],
      });
    }
  }
  return results;
}

module.exports = { matchJobs, scoreJob };
