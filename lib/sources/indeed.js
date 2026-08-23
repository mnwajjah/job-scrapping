/**
 * lib/sources/indeed.js — Scraper untuk Indeed Indonesia.
 * Pakai fetch + Cheerio. Indeed sering blokir bot, pakai headers semirip browser.
 * Fallback: RSS feed Indeed yang lebih toleran.
 */

const cheerio = require("cheerio");

const BASE_URL = "https://id.indeed.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Referer": "https://id.indeed.com/",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
};

async function searchJobs({ keyword, location, maxResults = 20 }) {
  // Coba RSS feed dulu — lebih toleran dan tidak butuh JS
  try {
    return await searchViaRss({ keyword, location, maxResults });
  } catch { /* fallback ke HTML */ }

  // Fallback: HTML scraping
  return searchViaHtml({ keyword, location, maxResults });
}

async function searchViaRss({ keyword, location, maxResults }) {
  const params = new URLSearchParams({ q: keyword || "developer", l: location || "Indonesia", sort: "date" });
  const rssUrl = `${BASE_URL}/rss?${params}`;

  const res = await fetch(rssUrl, { headers: { ...HEADERS, Accept: "application/rss+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`Indeed RSS: ${res.status}`);

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const jobs = [];

  $("item").each((_, el) => {
    const $el = $(el);
    const title = $el.find("title").text().trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    const link = $el.find("link").text().trim() || $el.find("guid").text().trim();
    const desc = $el.find("description").text().replace(/<[^>]+>/g, " ").trim().slice(0, 400);
    const location = $el.find("location").text().trim() || null;

    if (!title || !link) return;
    // Parse company dari title format "Job Title - Company Name"
    const parts = title.split(" - ");
    const jobTitle = parts[0]?.trim() || title;
    const company = parts[1]?.trim() || null;

    jobs.push({ title: jobTitle, company, location, salary: null, description: desc, url: link.split("?")[0] });
  });

  if (jobs.length === 0) throw new Error("Indeed RSS: kosong");
  return jobs.slice(0, maxResults);
}

async function searchViaHtml({ keyword, location, maxResults }) {
  const params = new URLSearchParams({ q: keyword || "developer", l: location || "" });
  const url = `${BASE_URL}/jobs?${params}`;
  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    const err = new Error(`Indeed: gagal load halaman (status ${res.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const jobs = [];

  $("div[class*='job_seen_beacon'], div[class*='resultContent'], div[class*='tapItem']").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2[class*='jobTitle'] a, a[data-testid='job-title']").first();
    const title = titleEl.text().trim() || $el.find("h2").first().text().trim();
    const href = titleEl.attr("href") || $el.find("a[href*='/rc/clk']").first().attr("href") || null;
    if (!title || !href) return;

    jobs.push({
      title,
      company: $el.find("[class*='company']").first().text().trim() || null,
      location: $el.find("[class*='location']").last().text().trim() || null,
      salary: $el.find("[class*='salary']").first().text().trim() || null,
      description: $el.find("[class*='job-snippet'], p").first().text().trim() || null,
      url: href.startsWith("http") ? href.split("?")[0] : `${BASE_URL}${href.split("?")[0]}`,
    });
  });

  const deduped = Array.from(new Map(jobs.filter((j) => j.url).map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    const err = new Error("Indeed: tidak ada lowongan ditemukan atau diblokir.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "indeed", label: "Indeed", searchJobs };
