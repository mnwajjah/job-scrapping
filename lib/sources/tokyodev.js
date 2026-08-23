/**
 * lib/sources/tokyodev.js — Scraper untuk TokyoDev.
 * TokyoDev adalah job board khusus developer di Jepang (English-friendly, banyak remote).
 */

const cheerio = require("cheerio");

const BASE_URL = "https://www.tokyodev.com";

async function searchJobs({ keyword, location, maxResults = 20 }) {
  // TokyoDev punya halaman jobs publik dengan filter
  const url = `${BASE_URL}/jobs`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CocokBot/1.0)",
      Accept: "text/html",
    },
  });

  if (!res.ok) {
    const err = new Error(`TokyoDev: gagal load halaman (status ${res.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const jobs = [];

  // TokyoDev job cards
  $("article, div[class*='job'], li[class*='job']").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2, h3, a[href*='/jobs/']").first();
    const title = titleEl.text().trim();
    const href = titleEl.attr("href") || $el.find("a[href*='/jobs/']").first().attr("href") || null;
    if (!title || !href) return;

    const company = $el.find("[class*='company'], [class*='employer']").first().text().trim() || null;
    const loc = $el.find("[class*='location'], [class*='remote']").first().text().trim() || "Japan / Remote";
    const tags = $el.find("[class*='tag'], [class*='skill'], span").map((_, t) => $(t).text().trim()).get().filter(Boolean).join(", ");

    jobs.push({
      title,
      company,
      location: loc,
      salary: $el.find("[class*='salary'], [class*='compensation']").first().text().trim() || null,
      description: (tags ? `Skills: ${tags}. ` : "") + $el.text().replace(/\s+/g, " ").slice(0, 300),
      url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
    });
  });

  // Keyword filter client-side
  let filtered = jobs;
  const kw = (keyword || "").trim().toLowerCase();
  if (kw) {
    filtered = jobs.filter(
      (j) => j.title.toLowerCase().includes(kw) || (j.description || "").toLowerCase().includes(kw)
    );
  }

  const deduped = Array.from(new Map(filtered.map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    // Return all jobs if keyword doesn't match (TokyoDev is curated, always relevant)
    const allDeduped = Array.from(new Map(jobs.map((j) => [j.url, j])).values());
    if (allDeduped.length === 0) {
      const err = new Error("TokyoDev: tidak ada lowongan ditemukan.");
      err.code = "SCRAPE_EMPTY";
      throw err;
    }
    return allDeduped.slice(0, maxResults);
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "tokyodev", label: "TokyoDev", searchJobs };
