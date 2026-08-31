// api/search.js
// Vercel serverless function — deploy this file at /api/search.js alongside
// index.html (Vercel auto-detects anything under /api as a serverless
// function, zero config needed).
//
// Why this exists: search-engine result pages (Google, Bing, DuckDuckGo)
// all send X-Frame-Options / CSP headers that block them from ever being
// shown inside an <iframe> — that's not a bug, it's deliberate on their
// end, and no client-side trick can get around it. So instead of framing a
// search engine's page, Nexa Browser asks THIS endpoint for real results
// and renders them in its own native results list.
//
// This fetches DuckDuckGo's no-JS HTML results page *server-side* (server
// ↔ server requests aren't subject to the browser's framing/CORS rules)
// and parses out title/url/snippet with a small regex-based parser.
//
// Caveat: because this scrapes a public HTML page rather than calling an
// official, versioned API, DuckDuckGo changing their markup could break the
// parser. For a production app, swap this out for an official search API
// (Bing Web Search API, SerpAPI, Google Programmable Search JSON API, etc.)
// — the frontend contract (`{ query, results: [{title,url,snippet}] }`)
// stays the same either way, so nothing else needs to change.

export default async function handler(req, res) {
  const q = (req.query.q || '').toString().trim();

  if (!q) {
    res.status(400).json({ error: 'Missing required query parameter: q' });
    return;
  }

  try {
    const upstreamUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const upstream = await fetch(upstreamUrl, {
      headers: {
        // A normal browser-like UA improves reliability with the no-JS endpoint.
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!upstream.ok) {
      throw new Error('Upstream search request failed with status ' + upstream.status);
    }

    const html = await upstream.text();
    const results = parseDuckDuckGoHtml(html).slice(0, 15);

    // Cache briefly at the edge to keep repeat queries fast and cheap.
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({ query: q, results });
  } catch (err) {
    res.status(502).json({
      error: 'Search backend unavailable',
      detail: (err && err.message) || String(err)
    });
  }
}

function parseDuckDuckGoHtml(html) {
  const results = [];
  // Each result block roughly looks like:
  //   <a rel="nofollow" class="result__a" href="...">Title</a> ... <a class="result__snippet" ...>Snippet</a>
  const blockRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    const url = extractRealUrl(match[1]);
    const title = stripTags(match[2]);
    const snippet = stripTags(match[3]);
    if (url && title) results.push({ title, url, snippet });
  }
  return results;
}

function stripTags(str) {
  return String(str)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function extractRealUrl(href) {
  try {
    const full = href.startsWith('//') ? 'https:' + href : href;
    const parsed = new URL(full, 'https://duckduckgo.com');
    // DuckDuckGo's HTML results wrap outbound links in a redirect that
    // carries the real target in the `uddg` query parameter.
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return full;
  } catch (e) {
    return null;
  }
}
