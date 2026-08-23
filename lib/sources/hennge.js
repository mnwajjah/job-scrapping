// 2026-07-06 added HENNGE scraper — server-rendered HTML, no headless browser needed
const cheerio = require("cheerio");

const LIST_URL = "https://recruit.hennge.com/en/mid-career-ngh/";

async function searchJobs({ keyword, maxResults = 20 }) {
  const res = await fetch(LIST_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CocokBot/1.0)" },
  });
  if (!res.ok) {
    const err = new Error(`HENNGE: gagal load halaman (status ${res.status}).`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const jobs = [];
  let currentDivision = null;

  // Divisi ditandai <h4>, lowongan di dalam <ul><li><a> setelahnya
  $("h4, ul li a").each((_, el) => {
    const tag = el.tagName;
    if (tag === "h4") {
      currentDivision = $(el).text().trim();
      return;
    }
    const $a = $(el);
    const href = $a.attr("href");
    const title = $a.text().trim();
    if (!href || !title) return;
    if (!href.includes("mid-career")) return;
    // hindari nav/apply link generik
    if (/\/(apply|faq-for-screening-process|hennges-admission)/i.test(href) && !href.includes("gh_jid")) return;

    jobs.push({
      title,
      company: "HENNGE",
      location: "Tokyo, Japan",
      salary: null,
      description: currentDivision ? `Divisi: ${currentDivision}` : "",
      url: href.startsWith("http") ? href : new URL(href, LIST_URL).toString(),
    });
  });

  let filtered = jobs;
  if (keyword && keyword.trim()) {
    const kw = keyword.trim().toLowerCase();
    filtered = jobs.filter((j) => j.title.toLowerCase().includes(kw) || (j.description || "").toLowerCase().includes(kw));
  }

  const deduped = Array.from(new Map(filtered.map((j) => [j.url, j])).values());

  if (deduped.length === 0) {
    const err = new Error("HENNGE: tidak ada lowongan cocok, atau struktur halaman berubah.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }

  return deduped.slice(0, maxResults);
}

module.exports = { id: "hennge", label: "HENNGE", searchJobs };
