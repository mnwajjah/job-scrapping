/**
 * lib/sources/techinasia.js — Scraper untuk Tech in Asia Jobs.
 * Pakai fetch ke API listing publik mereka.
 */

const cheerio = require("cheerio");

async function searchJobs({ keyword, location, maxResults = 20 }) {
  // Tech in Asia punya JSON search API
  const params = new URLSearchParams({
    q: keyword || "",
    page: 1,
    per_page: maxResults,
  });

  const res = await fetch(`https://www.techinasia.com/api/2.0/jobs?${params}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CocokBot/1.0)",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (res.ok) {
    try {
      const data = await res.json();
      const items = data.data || data.jobs || [];
      if (items.length > 0) {
        const jobs = items.slice(0, maxResults).map((j) => ({
          title: j.title || j.name || "(tanpa judul)",
          company: j.company?.name || j.employer?.name || null,
          location: j.location || (Array.isArray(j.locations) ? j.locations[0] : null),
          salary: null,
          description: (j.description || j.excerpt || "").replace(/<[^>]+>/g, " ").slice(0, 400),
          url: j.url || (j.slug ? `https://www.techinasia.com/jobs/${j.slug}` : null),
        })).filter((j) => j.title && j.url);

        if (jobs.length > 0) return jobs;
      }
    } catch { /* fallback ke scrape */ }
  }

  // Fallback: scrape HTML listing page
  const htmlUrl = `https://www.techinasia.com/jobs?query=${encodeURIComponent(keyword || "")}`;
  const htmlRes = await fetch(htmlUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CocokBot/1.0)" },
  });

  if (!htmlRes.ok) {
    const err = new Error(`Tech in Asia: gagal load halaman (status ${htmlRes.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await htmlRes.text();
  const $ = cheerio.load(html);
  const jobs = [];

  $("a[href*='/jobs/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.match(/\/jobs\/[a-z0-9-]+/)) return;
    const title = $(el).text().trim();
    if (!title || title.length < 3) return;

    const $card = $(el).closest("div, li, article");
    const company = $card.find("[class*='company'], [class*='employer'], [class*='startup']").first().text().trim() || null;
    const loc = $card.find("[class*='location'], [class*='city']").first().text().trim() || null;

    jobs.push({
      title,
      company,
      location: loc,
      salary: null,
      description: $card.text().replace(/\s+/g, " ").slice(0, 300),
      url: href.startsWith("http") ? href : `https://www.techinasia.com${href}`,
    });
  });

  const deduped = Array.from(new Map(jobs.map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    const err = new Error("Tech in Asia: tidak ada lowongan ditemukan atau struktur halaman berubah.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "techinasia", label: "Tech in Asia", searchJobs };
