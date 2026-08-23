/**
 * lib/matcher.js — AI matching probabilistik via Gemini.
 * STRATEGI: Batch 5 jobs per 1 API call → jauh lebih cepat, kurangi timeout.
 * Serial antar batch untuk hindari rate limit.
 */

const MODEL = "gemini-3.6-flash";

const BATCH_SIZE = 5; // Jobs per Gemini call

function buildBatchPrompt({ cvText, jobs }) {
  const jobList = jobs.map((j, i) => `
JOB #${i + 1}
Judul: ${j.title}
Perusahaan: ${j.company || "-"}
Lokasi: ${j.location || "-"}
Gaji: ${j.salary || "tidak disebutkan"}
Deskripsi: ${(j.description || "(kosong)").slice(0, 300)}`).join("\n---");

  return `Kamu adalah ahli rekrutmen senior. Untuk SETIAP lowongan di bawah, analisis peluang kandidat lolos interview berdasarkan CV ini.

=== CV KANDIDAT ===
${cvText}

=== DAFTAR LOWONGAN ===
${jobList}

=== INSTRUKSI ===
Return array JSON dengan ${jobs.length} objek, SATU per lowongan, urut dari JOB #1 s/d JOB #${jobs.length}.

Untuk tiap lowongan, hitung skor peluang lolos (0-100) berdasarkan:
1. Tech Stack (40%): required vs nice-to-have. "nice-to-have" tidak kurangi banyak. PHP/JS/Node/React = transferable skill kuat. Tech bisa dipelajari <3 bulan → "canLearn", kurangi sedikit saja.
2. Experience (30%): lama & relevansi vs requirement.
3. Bonus (30%): production deploy, portfolio SaaS, sertifikat mandiri, TOEFL 627 (untuk remote/internasional), lokasi Batam (remote/relokasi).

chanceLabel: "Sangat Tinggi" (≥80), "Tinggi" (65-79), "Sedang" (45-64), "Rendah" (<45)
recommendation: "Apply sekarang!" (≥70) | "Apply dengan persiapan portfolio" (55-69) | "Apply kalau tertarik belajar tech-nya" (40-54) | "Lewati dulu" (<40)

Jujur dan realistis.`;
}

const BATCH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
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
            properties: { score: { type: "integer" }, note: { type: "string" } },
            required: ["score", "note"],
          },
          strengths: { type: "array", items: { type: "string" } },
          gaps:      { type: "array", items: { type: "string" } },
        },
        required: ["score", "chanceLabel", "recommendation", "reasoning", "techStackMatch", "experienceMatch", "strengths", "gaps"],
      },
    },
  },
  required: ["results"],
};

// Lazy-loaded Gemini client (ESM)
let _genai = null;
async function getClient() {
  if (_genai) return _genai;
  const { GoogleGenAI } = await import("@google/genai");
  _genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _genai;
}

async function scoreBatch({ cvText, jobs }) {
  const client = await getClient();
  const res = await client.models.generateContent({
    model: MODEL,
    contents: buildBatchPrompt({ cvText, jobs }),
    config: {
      responseMimeType: "application/json",
      responseSchema: BATCH_RESPONSE_SCHEMA,
    },
  });

  const parsed = JSON.parse(res.text);
  const results = parsed.results || [];

  // Merge AI scores back ke job objects
  return jobs.map((job, i) => {
    const r = results[i];
    if (!r) return { ...job, matchScore: 0, chanceLabel: "Error", recommendation: "-", reasoning: "Tidak ada hasil dari AI", techStackMatch: { matched: [], canLearn: [], missing: [], score: 0 }, experienceMatch: { score: 0, note: "-" }, strengths: [], gaps: [] };
    return {
      ...job,
      matchScore:      r.score,
      chanceLabel:     r.chanceLabel,
      recommendation:  r.recommendation,
      reasoning:       r.reasoning,
      techStackMatch:  r.techStackMatch,
      experienceMatch: r.experienceMatch,
      strengths:       r.strengths || [],
      gaps:            r.gaps || [],
    };
  });
}

async function matchJobs({ cvText, jobs }) {
  const allResults = [];

  // Split jobs ke batch, proses serial antar batch
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    try {
      const scored = await scoreBatch({ cvText, jobs: batch });
      allResults.push(...scored);
    } catch (err) {
      console.error(`[matcher] batch ${i}–${i + BATCH_SIZE} gagal:`, err.message);
      // Fallback: tandai semua job di batch ini sebagai error
      batch.forEach((job) => allResults.push({
        ...job,
        matchScore: 0,
        chanceLabel: "Error",
        recommendation: "-",
        reasoning: `Gagal dianalisis: ${err.message}`,
        techStackMatch: { matched: [], canLearn: [], missing: [], score: 0 },
        experienceMatch: { score: 0, note: "-" },
        strengths: [],
        gaps: [],
      }));
    }
  }

  return allResults;
}

module.exports = { matchJobs, scoreBatch };
