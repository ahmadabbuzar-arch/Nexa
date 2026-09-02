// api/search.js
// Vercel serverless function — deployed at /api/search.js alongside
// index.html (Vercel auto-detects anything under /api, zero config needed).
//
// Why this exists: search-engine result pages (Google, Bing, DuckDuckGo)
// all send X-Frame-Options / CSP headers that block them from ever being
// shown inside an <iframe> — that's deliberate on their end, and no
// client-side trick can get around it. So instead of framing a search
// engine's page, Nexa Browser asks THIS endpoint for real results and
// renders them in its own native results list — including web, image, and
// shopping-flavored results.
//
// Uses Firecrawl's "keyless" Search API — no signup, no API key, no billing
// required to get working. Add a free FIRECRAWL_API_KEY env var later for
// higher rate limits; not required otherwise.
//
// Query params:
//   q     — the search query (required)
//   type  — "web" (default), "images", or "shopping"

const SHOPPING_DOMAINS = [
  'amazon.com', 'walmart.com', 'ebay.com', 'target.com', 'bestbuy.com',
  'etsy.com', 'aliexpress.com', 'flipkart.com', 'homedepot.com', 'macys.com'
];

export default async function handler(req, res) {
  const q = (req.query.q || '').toString().trim();
  const type = (req.query.type || 'web').toString().trim();

  if (!q) {
    res.status(400).json({ error: 'Missing required query parameter: q' });
    return;
  }

  const body = { query: q, limit: 10 };
  if (type === 'images') {
    body.sources = ['images'];
  } else if (type === 'shopping') {
    body.sources = ['web'];
    body.includeDomains = SHOPPING_DOMAINS;
  } else if (type === 'news') {
    body.sources = ['news'];
  } else {
    body.sources = ['web'];
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    // Optional: add a free Firecrawl API key as FIRECRAWL_API_KEY in Vercel
    // env vars for higher rate limits. Works fine without it.
    if (process.env.FIRECRAWL_API_KEY) {
      headers['Authorization'] = 'Bearer ' + process.env.FIRECRAWL_API_KEY;
    }

    const upstream = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const data = await upstream.json();

    if (!upstream.ok || !data.success) {
      throw new Error((data && data.error) || ('Upstream request failed with status ' + upstream.status));
    }

    let results;
    if (type === 'images') {
      results = ((data.data && data.data.images) || []).map(item => ({
        title: item.title || '',
        imageUrl: item.imageUrl,
        sourceUrl: item.url,
        width: item.imageWidth,
        height: item.imageHeight
      })).filter(r => r.imageUrl);
    } else if (type === 'news') {
      results = ((data.data && data.data.news) || []).map(item => ({
        title: item.title || item.url,
        url: item.url,
        snippet: cleanSnippet(item.snippet || item.description)
      }));
    } else {
      results = ((data.data && data.data.web) || []).map(item => ({
        title: item.title || item.url,
        url: item.url,
        snippet: cleanSnippet(item.description)
      }));
    }

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    res.status(200).json({ query: q, type, results });
  } catch (err) {
    res.status(502).json({
      error: 'Search backend unavailable',
      detail: (err && err.message) || String(err)
    });
  }
}

// Some pages return raw markdown-ish or link-heavy text as their
// description — strip that down to plain, readable text for the list.
function cleanSnippet(raw) {
  if (!raw) return '';
  let text = String(raw)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) -> label
    .replace(/\*\*([^*]*)\*\*/g, '$1')       // **bold** -> bold
    .replace(/[*_#`>]/g, '')                 // stray markdown symbols
    .replace(/https?:\/\/\S+/g, '')          // bare URLs
    .replace(/\s+/g, ' ')                    // collapse whitespace/newlines
    .trim();
  if (text.length > 180) text = text.slice(0, 177).trim() + '…';
  return text;
}
