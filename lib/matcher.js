// 2026-07-06 switched from Anthropic SDK to Gemini
const { GoogleGenAI, Type } = require("@google/genai");

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = "gemini-2.5-flash";

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.INTEGER },
    reasoning: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["score", "reasoning", "strengths", "gaps"],
};

function buildPrompt({ cvText, job }) {
  return `Kamu adalah asisten rekrutmen. Nilai seberapa cocok kandidat berikut untuk lowongan ini.

=== CV KANDIDAT ===
${cvText}

=== LOWONGAN ===
Judul: ${job.title}
Perusahaan: ${job.company || "-"}
Lokasi: ${job.location || "-"}
Deskripsi: ${job.description || "-"}

Nilai skor 0-100, kasih alasan singkat, poin kekuatan (strengths), dan poin kekurangan (gaps).`;
}

async function scoreJob({ cvText, job }) {
  const res = await client.models.generateContent({
    model: MODEL,
    contents: buildPrompt({ cvText, job }),
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  const parsed = JSON.parse(res.text);
  return { ...job, matchScore: parsed.score, reasoning: parsed.reasoning, strengths: parsed.strengths, gaps: parsed.gaps };
}

async function matchJobs({ cvText, jobs }) {
  return Promise.all(jobs.map((job) => scoreJob({ cvText, job })));
}

module.exports = { matchJobs };
