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
// This calls Google's official, free Programmable Search Engine API
// (Custom Search JSON API) server-side. Using the official API instead of
// scraping a results page means it won't get blocked the way scraping
// DuckDuckGo's HTML page did (that approach hit DuckDuckGo's anti-bot
// protection and returned 403 — trying to force past that with fake
// headers/proxies would just be fighting a protection another site put
// there on purpose, so this uses the supported, documented route instead).
//
// ── ONE-TIME SETUP (free, ~5 minutes, entirely from a phone browser) ──
// 1. Go to https://programmablesearchengine.google.com/ → "Add" a new
//    search engine → under "Sites to search" choose "Search the entire
//    web" → create it. Copy its "Search engine ID" (this is CX below).
// 2. Go to https://console.cloud.google.com/apis/library/customsearch.googleapis.com
//    → enable "Custom Search API" for a project → go to "Credentials" →
//    "Create credentials" → "API key". Copy that key.
// 3. In your Vercel project: Settings → Environment Variables → add:
//      GOOGLE_API_KEY = <the API key from step 2>
//      GOOGLE_CX      = <the Search engine ID from step 1>
//    then redeploy (Vercel → Deployments → ⋯ → Redeploy).
// Free tier: 100 searches/day. Response shape stays { query, results:
// [{title,url,snippet}] } — nothing on the frontend needs to change if you
// swap this for a different provider later (Bing Web Search API, SerpApi,
// etc.) as long as you keep that same shape.

export default async function handler(req, res) {
  const q = (req.query.q || '').toString().trim();

  if (!q) {
    res.status(400).json({ error: 'Missing required query parameter: q' });
    return;
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CX;

  if (!apiKey || !cx) {
    // Setup not done yet — fail clearly instead of silently returning
    // nothing, so it's obvious this needs the one-time setup above rather
    // than looking like a bug.
    res.status(501).json({
      error: 'Search API not configured',
      detail: 'Set GOOGLE_API_KEY and GOOGLE_CX as environment variables in your Vercel project settings, then redeploy. See the setup steps in api/search.js.'
    });
    return;
  }

  try {
    const upstreamUrl =
      'https://www.googleapis.com/customsearch/v1' +
      '?key=' + encodeURIComponent(apiKey) +
      '&cx=' + encodeURIComponent(cx) +
      '&q=' + encodeURIComponent(q);

    const upstream = await fetch(upstreamUrl);
    const data = await upstream.json();

    if (!upstream.ok) {
      throw new Error((data && data.error && data.error.message) || ('Upstream request failed with status ' + upstream.status));
    }

    const results = (data.items || []).map(item => ({
      title: item.title || item.link,
      url: item.link,
      snippet: item.snippet || ''
    }));

    // Cache briefly at the edge to keep repeat queries fast and cheap
    // against the 100/day free quota.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ query: q, results });
  } catch (err) {
    res.status(502).json({
      error: 'Search backend unavailable',
      detail: (err && err.message) || String(err)
    });
  }
}
