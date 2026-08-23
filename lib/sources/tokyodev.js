/**
 * lib/sources/tokyodev.js — Scraper untuk TokyoDev.
 * TokyoDev punya RSS feed dan JSON API — lebih reliable dari HTML scraping.
 */

const cheerio = require("cheerio");

const BASE_URL = "https://www.tokyodev.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.tokyodev.com/",
};

async function searchJobs({ keyword, location, maxResults = 20 }) {
  // TokyoDev punya RSS feed
  try {
    return await searchViaRss({ keyword, maxResults });
  } catch { /* fallback */ }

  return searchViaHtml({ keyword, maxResults });
}

async function searchViaRss({ keyword, maxResults }) {
  const res = await fetch(`${BASE_URL}/jobs.rss`, {
    headers: { ...HEADERS, Accept: "application/rss+xml, application/xml" },
  });
  if (!res.ok) throw new Error(`TokyoDev RSS: ${res.status}`);

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const jobs = [];

  $("item").each((_, el) => {
    const $el = $(el);
    const title = $el.find("title").text().trim();
    const link = $el.find("link").text().trim() || $el.find("guid").text().trim();
    const desc = $el.find("description").text().replace(/<[^>]+>/g, " ").trim().slice(0, 400);
    const company = $el.find("author, dc\\:creator").text().trim() || null;

    if (!title || !link) return;
    jobs.push({ title, company, location: "Japan / Remote", salary: null, description: desc, url: link });
  });

  if (jobs.length === 0) throw new Error("TokyoDev RSS: kosong");

  // Filter by keyword kalau ada
  const kw = (keyword || "").toLowerCase();
  const filtered = kw
    ? jobs.filter((j) => j.title.toLowerCase().includes(kw) || (j.description || "").toLowerCase().includes(kw))
    : jobs;

  return (filtered.length > 0 ? filtered : jobs).slice(0, maxResults);
}

async function searchViaHtml({ keyword, maxResults }) {
  const res = await fetch(`${BASE_URL}/jobs`, { headers: HEADERS });

  if (!res.ok) {
    const err = new Error(`TokyoDev: gagal load halaman (status ${res.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const jobs = [];

  // TokyoDev uses various card structures
  $("article, [class*='job-listing'], [class*='JobCard'], li[class*='job']").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2, h3, [class*='title']").first();
    const title = titleEl.text().trim();
    const href = $el.find("a[href*='/jobs/']").first().attr("href") ||
                 $el.find("a[href]").first().attr("href") || null;
    if (!title || !href || title.length < 3) return;

    const company = $el.find("[class*='company'], [class*='employer'], [class*='CompanyName']").first().text().trim() || null;

    jobs.push({
      title,
      company,
      location: "Japan / Remote",
      salary: $el.find("[class*='salary'], [class*='compensation']").first().text().trim() || null,
      description: $el.text().replace(/\s+/g, " ").slice(0, 350),
      url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
    });
  });

  const kw = (keyword || "").toLowerCase();
  const filtered = kw
    ? jobs.filter((j) => j.title.toLowerCase().includes(kw) || (j.description || "").toLowerCase().includes(kw))
    : jobs;

  const result = filtered.length > 0 ? filtered : jobs;
  const deduped = Array.from(new Map(result.map((j) => [j.url, j])).values());

  if (deduped.length === 0) {
    const err = new Error("TokyoDev: tidak ada lowongan ditemukan.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "tokyodev", label: "TokyoDev", searchJobs };
