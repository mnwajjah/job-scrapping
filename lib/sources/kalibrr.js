/**
 * lib/sources/kalibrr.js — Scraper untuk Kalibrr Indonesia.
 * Kalibrr punya JSON API publik untuk listing jobs.
 */

const cheerio = require("cheerio");

const SEARCH_URL = "https://www.kalibrr.id/job-board/te";

async function searchJobs({ keyword, location, maxResults = 20 }) {
  // Kalibrr API endpoint
  const params = new URLSearchParams({
    limit: maxResults,
    offset: 0,
    keyword: keyword || "",
  });
  if (location && location.trim()) params.set("location", location.trim());

  const apiUrl = `https://www.kalibrr.id/api/jobs/search?${params}`;

  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CocokBot/1.0)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    // Fallback ke scraping HTML
    return scrapeHtml({ keyword, location, maxResults });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return scrapeHtml({ keyword, location, maxResults });
  }

  const items = Array.isArray(data.jobs) ? data.jobs : Array.isArray(data) ? data : [];
  if (items.length === 0) return scrapeHtml({ keyword, location, maxResults });

  const jobs = items.slice(0, maxResults).map((j) => ({
    title: j.name || j.title || "(tanpa judul)",
    company: j.company?.name || j.employer?.name || null,
    location: j.locations?.[0]?.name || j.location || null,
    salary: j.salary_range || null,
    description: (j.description || j.teaser || "").replace(/<[^>]+>/g, " ").slice(0, 400),
    url: j.code ? `https://www.kalibrr.id/c/${j.company?.code}/jobs/${j.code}` : null,
  })).filter((j) => j.title && j.url);

  if (jobs.length === 0) return scrapeHtml({ keyword, location, maxResults });
  return jobs;
}

async function scrapeHtml({ keyword, location, maxResults }) {
  const url = `https://www.kalibrr.id/lowongan-kerja?keyword=${encodeURIComponent(keyword || "")}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CocokBot/1.0)" },
  });
  if (!res.ok) {
    const err = new Error(`Kalibrr: gagal load halaman (status ${res.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const jobs = [];

  $("a[href*='/c/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.includes("/jobs/")) return;
    const title = $(el).text().trim();
    if (!title || title.length < 3) return;
    const $card = $(el).closest("[class*='job'], [class*='card'], li, article");
    const company = $card.find("[class*='company'], [class*='employer']").first().text().trim() || null;
    const loc = $card.find("[class*='location'], [class*='city']").first().text().trim() || null;

    jobs.push({
      title,
      company,
      location: loc,
      salary: null,
      description: $card.text().replace(/\s+/g, " ").slice(0, 300),
      url: href.startsWith("http") ? href : `https://www.kalibrr.id${href}`,
    });
  });

  const deduped = Array.from(new Map(jobs.map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    const err = new Error("Kalibrr: tidak ada lowongan ditemukan.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "kalibrr", label: "Kalibrr", searchJobs };
