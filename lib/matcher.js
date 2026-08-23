/**
 * lib/matcher.js — AI matching probabilistik via Gemini.
 * STRATEGI: Semua batch jalan PARALEL → total waktu = waktu 1 batch saja.
 * Max 10 jobs → 2 batch paralel → ~8-12 detik total.
 */

const MODEL = "gemini-3.6-flash";
const BATCH_SIZE = 5;

function buildBatchPrompt({ cvText, jobs }) {
  const jobList = jobs.map((j, i) =>
    `[${i + 1}] ${j.title} @ ${j.company || "?"} | ${j.location || "?"}\n${(j.description || "").slice(0, 200)}`
  ).join("\n\n");

  return `Nilai peluang lolos interview (0-100) untuk kandidat ini vs ${jobs.length} lowongan.

CV KANDIDAT (ringkas):
${cvText.slice(0, 1200)}

LOWONGAN:
${jobList}

Kembalikan array JSON ${jobs.length} objek. Setiap objek:
- score (int 0-100): peluang lolos keseluruhan
- chanceLabel: "Sangat Tinggi"(≥80)/"Tinggi"(65-79)/"Sedang"(45-64)/"Rendah"(<45)
- recommendation: "Apply sekarang!"(≥70)/"Apply dengan persiapan portfolio"(55-69)/"Apply kalau tertarik belajar tech-nya"(40-54)/"Lewati dulu"(<40)
- reasoning: 1-2 kalimat alasan
- techStackMatch: {matched:[], canLearn:[], missing:[], score:int}
- experienceMatch: {score:int, note:string}
- strengths: string[]
- gaps: string[]

Catatan penilaian: nice-to-have tech tidak kurangi banyak. PHP/JS/Node/React = transferable. Tech bisa dipelajari cepat → canLearn.`;
}

const BATCH_SCHEMA = {
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
};

// Lazy-loaded Gemini client
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
      responseSchema: BATCH_SCHEMA,
    },
  });

  const parsed = JSON.parse(res.text);
  const results = Array.isArray(parsed) ? parsed : (parsed.results || []);

  return jobs.map((job, i) => {
    const r = results[i];
    if (!r) return errorJob(job, "Tidak ada hasil dari AI");
    return {
      ...job,
      matchScore:      r.score,
      chanceLabel:     r.chanceLabel,
      recommendation:  r.recommendation,
      reasoning:       r.reasoning,
      techStackMatch:  r.techStackMatch || { matched: [], canLearn: [], missing: [], score: 0 },
      experienceMatch: r.experienceMatch || { score: 0, note: "-" },
      strengths:       r.strengths || [],
      gaps:            r.gaps || [],
    };
  });
}

function errorJob(job, msg) {
  return {
    ...job,
    matchScore: 0,
    chanceLabel: "Error",
    recommendation: "-",
    reasoning: msg,
    techStackMatch: { matched: [], canLearn: [], missing: [], score: 0 },
    experienceMatch: { score: 0, note: "-" },
    strengths: [],
    gaps: [],
  };
}

async function matchJobs({ cvText, jobs }) {
  // Split ke batch
  const batches = [];
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    batches.push(jobs.slice(i, i + BATCH_SIZE));
  }

  // Jalankan SEMUA batch PARALEL — total waktu = waktu batch terlama (bukan jumlah)
  const batchResults = await Promise.allSettled(
    batches.map((batch) => scoreBatch({ cvText, jobs: batch }))
  );

  const allResults = [];
  batchResults.forEach((r, bi) => {
    if (r.status === "fulfilled") {
      allResults.push(...r.value);
    } else {
      console.error(`[matcher] batch ${bi} gagal:`, r.reason?.message);
      batches[bi].forEach((job) => allResults.push(errorJob(job, r.reason?.message || "Batch gagal")));
    }
  });

  return allResults;
}

module.exports = { matchJobs };
