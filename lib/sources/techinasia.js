/**
 * lib/sources/techinasia.js — Scraper untuk Tech in Asia Jobs.
 * Pakai public job listing API mereka.
 */

const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/html, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.techinasia.com/jobs",
};

async function searchJobs({ keyword, location, maxResults = 20 }) {
  // Tech in Asia RSS / public JSON feed
  const params = new URLSearchParams({
    q: keyword || "developer",
    page: 1,
    per_page: maxResults,
  });

  const res = await fetch(`https://www.techinasia.com/api/2.0/jobs?${params}`, {
    headers: { ...HEADERS, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
  });

  if (res.ok) {
    try {
      const data = await res.json();
      const items = data.data || data.jobs || [];
      if (items.length > 0) {
        return items.slice(0, maxResults).map((j) => ({
          title: j.title || j.name || "(tanpa judul)",
          company: j.company?.name || j.employer?.name || null,
          location: j.location || (Array.isArray(j.locations) ? j.locations[0] : null),
          salary: null,
          description: (j.description || j.excerpt || "").replace(/<[^>]+>/g, " ").slice(0, 400),
          url: j.url || (j.slug ? `https://www.techinasia.com/jobs/${j.slug}` : null),
        })).filter((j) => j.title && j.url);
      }
    } catch { /* fallback */ }
  }

  // Fallback: scrape HTML
  const htmlUrl = `https://www.techinasia.com/jobs?query=${encodeURIComponent(keyword || "developer")}`;
  const htmlRes = await fetch(htmlUrl, { headers: HEADERS });

  if (!htmlRes.ok) {
    const err = new Error(`Tech in Asia: gagal load halaman (status ${htmlRes.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await htmlRes.text();
  const $ = cheerio.load(html);
  const jobs = [];

  // Coba ambil dari __NEXT_DATA__ (Next.js app)
  const nextData = $("script#__NEXT_DATA__").html();
  if (nextData) {
    try {
      const parsed = JSON.parse(nextData);
      const jobList =
        parsed?.props?.pageProps?.jobs ||
        parsed?.props?.pageProps?.data?.jobs ||
        [];
      if (jobList.length > 0) {
        return jobList.slice(0, maxResults).map((j) => ({
          title: j.title || j.name,
          company: j.company?.name || null,
          location: j.location || null,
          salary: null,
          description: (j.description || "").replace(/<[^>]+>/g, " ").slice(0, 300),
          url: j.url || `https://www.techinasia.com/jobs/${j.slug}`,
        })).filter((j) => j.title && j.url);
      }
    } catch { /* fallback ke selector */ }
  }

  $("a[href*='/jobs/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.match(/\/jobs\/[a-z0-9-]+/)) return;
    const title = $(el).text().trim();
    if (!title || title.length < 3) return;
    const $card = $(el).closest("div, li, article");
    jobs.push({
      title,
      company: $card.find("[class*='company'], [class*='employer']").first().text().trim() || null,
      location: $card.find("[class*='location']").first().text().trim() || null,
      salary: null,
      description: $card.text().replace(/\s+/g, " ").slice(0, 300),
      url: href.startsWith("http") ? href : `https://www.techinasia.com${href}`,
    });
  });

  const deduped = Array.from(new Map(jobs.map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    const err = new Error("Tech in Asia: tidak ada lowongan ditemukan.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "techinasia", label: "Tech in Asia", searchJobs };
