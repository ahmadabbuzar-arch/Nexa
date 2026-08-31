// api/search.js
// Vercel serverless function — deployed at /api/search.js alongside
// index.html (Vercel auto-detects anything under /api, zero config needed).
//
// Why this exists: search-engine result pages (Google, Bing, DuckDuckGo)
// all send X-Frame-Options / CSP headers that block them from ever being
// shown inside an <iframe> — that's deliberate on their end, and no
// client-side trick can get around it. So instead of framing a search
// engine's page, Nexa Browser asks THIS endpoint for real results and
// renders them in its own native results list.
//
// This calls Firecrawl's "keyless" Search API — a hosted search endpoint
// that works with NO signup and NO API key at all (rate-limited per IP;
// add a free Firecrawl API key later via the FIRECRAWL_API_KEY env var
// for higher limits, but it isn't required to get this working).
//
// No setup needed. This works as soon as it's deployed.
//
// (Earlier versions of this endpoint tried scraping DuckDuckGo's HTML page
// directly — which got IP-blocked — and then Google's Custom Search JSON
// API, which needs a Cloud project with billing linked. Firecrawl's keyless
// endpoint avoids both of those problems.)

export default async function handler(req, res) {
  const q = (req.query.q || '').toString().trim();

  if (!q) {
    res.status(400).json({ error: 'Missing required query parameter: q' });
    return;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    // Optional: if you later create a free Firecrawl account and add
    // FIRECRAWL_API_KEY as a Vercel environment variable, requests will
    // automatically use it for higher rate limits. Not required otherwise.
    if (process.env.FIRECRAWL_API_KEY) {
      headers['Authorization'] = 'Bearer ' + process.env.FIRECRAWL_API_KEY;
    }

    const upstream = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: q, limit: 10 })
    });

    const data = await upstream.json();

    if (!upstream.ok || !data.success) {
      throw new Error((data && data.error) || ('Upstream request failed with status ' + upstream.status));
    }

    const results = ((data.data && data.data.web) || []).map(item => ({
      title: item.title || item.url,
      url: item.url,
      snippet: cleanSnippet(item.description)
    }));

    // Cache briefly at the edge to keep repeat queries fast and cheap.
    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    res.status(200).json({ query: q, results });
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
