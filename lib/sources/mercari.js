// 2026-07-06 added Mercari scraper — pakai Greenhouse Job Board API publik
// (boards-api.greenhouse.io), bukan scraping HTML. Lebih stabil dari Puppeteer.
const API_URL = "https://boards-api.greenhouse.io/v1/boards/mercari/jobs?content=true";

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchJobs({ keyword, location, maxResults = 20 }) {
  const res = await fetch(API_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const err = new Error(`Mercari: gagal ambil data dari Greenhouse (status ${res.status}).`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }
  const data = await res.json();
  let jobs = (data.jobs || []).map((j) => ({
    title: j.title,
    company: "Mercari",
    location: j.location && j.location.name ? j.location.name : null,
    salary: null,
    description: stripHtml(j.content).slice(0, 500),
    url: j.absolute_url,
  }));

  const kw = (keyword || "").trim().toLowerCase();
  if (kw) {
    jobs = jobs.filter(
      (j) => j.title.toLowerCase().includes(kw) || (j.description || "").toLowerCase().includes(kw)
    );
  }
  if (location && location.trim()) {
    const loc = location.trim().toLowerCase();
    jobs = jobs.filter((j) => (j.location || "").toLowerCase().includes(loc));
  }

  if (jobs.length === 0) {
    const err = new Error("Mercari: tidak ada lowongan cocok dengan kata kunci saat ini.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }

  return jobs.slice(0, maxResults);
}

module.exports = { id: "mercari", label: "Mercari", searchJobs };
