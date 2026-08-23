// 2026-07-06 added Glints scraper — server-rendered listing, no headless browser
const cheerio = require("cheerio");

const LIST_URL = "https://glints.com/id/en/lowongan-kerja";

async function searchJobs({ keyword, location, maxResults = 20 }) {
  const res = await fetch(LIST_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CocokBot/1.0)" },
  });
  if (!res.ok) {
    const err = new Error(`Glints: gagal load halaman (status ${res.status}).`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  // Glints tidak filter keyword lewat query string di HTML mentah, jadi kita
  // ambil semua kartu lalu filter sendiri di sisi server.
  const jobs = [];
  $('a[href*="/opportunities/jobs/"]').each((_, el) => {
    const $a = $(el);
    const title = $a.text().trim();
    const href = $a.attr("href");
    if (!title || !href) return;

    // Kartu job = blok leluhur terdekat yang juga berisi link perusahaan & lokasi
    const $card = $a.closest("div, li, article").length
      ? $a.parents().filter((__, p) => $(p).find('a[href*="/companies/"]').length > 0).first()
      : $a.parent();

    const companyEl = $card.find('a[href*="/companies/"]').first();
    const locationEl = $card.find('a[href*="/job-location/"]').first();
    const cardText = $card.text().replace(/\s+/g, " ").trim();

    jobs.push({
      title,
      company: companyEl.text().trim() || null,
      location: locationEl.text().trim() || null,
      salary: null,
      description: cardText.slice(0, 300),
      url: href.startsWith("http") ? href.split("?")[0] : new URL(href, LIST_URL).toString().split("?")[0],
    });
  });

  let filtered = jobs;
  const kw = (keyword || "").trim().toLowerCase();
  if (kw) {
    filtered = jobs.filter(
      (j) => j.title.toLowerCase().includes(kw) || (j.description || "").toLowerCase().includes(kw)
    );
  }
  if (location && location.trim()) {
    const loc = location.trim().toLowerCase();
    filtered = filtered.filter((j) => (j.location || "").toLowerCase().includes(loc));
  }

  const deduped = Array.from(new Map(filtered.map((j) => [j.url, j])).values());

  if (deduped.length === 0) {
    const err = new Error("Glints: tidak ada lowongan cocok dengan kata kunci, atau struktur halaman berubah.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }

  return deduped.slice(0, maxResults);
}

module.exports = { id: "glints", label: "Glints", searchJobs };
