// api/ai.js
// Vercel serverless function — deployed at /api/ai.js alongside index.html
// (Vercel auto-detects anything under /api, zero config needed).
//
// This is the real backend for Nexa AI. It calls Groq's OpenAI-compatible
// chat completions API server-side, using an API key that never reaches
// the browser. The frontend already calls fetch('/api/ai', { prompt,
// pageText, style, provider }) and expects back { reply }.
//
// ── ONE-TIME SETUP (free, phone-friendly) ──
// 1. Go to https://console.groq.com/keys → sign in → "Create API Key".
//    Copy the key (starts with "gsk_...").
// 2. In your Vercel project: Settings → Environment Variables → add
//      GROQ_API_KEY = <the key from step 1>
//    then redeploy (Deployments → ⋯ → Redeploy).
// Groq's free tier needs no credit card and is generous for personal use.

const STYLE_HINTS = {
  concise: 'Answer briefly — a few sentences at most.',
  balanced: 'Answer clearly and completely, but stay reasonably concise.',
  detailed: 'Answer thoroughly, with helpful detail and structure.'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { prompt, pageText, style } = req.body || {};
  const q = (prompt || '').toString().trim();

  if (!q) {
    res.status(400).json({ error: 'Missing required field: prompt' });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(501).json({
      error: 'AI backend not configured',
      detail: 'Set GROQ_API_KEY as an environment variable in your Vercel project settings, then redeploy. See the setup steps in api/ai.js.'
    });
    return;
  }

  const styleHint = STYLE_HINTS[style] || STYLE_HINTS.balanced;
  const systemPrompt =
    'You are Nexa AI, a helpful assistant built into the Nexa Browser. ' +
    styleHint +
    ' Answer in plain text (no markdown headers or code fences unless the user asks for code). ' +
    'If page content is provided, ground your answer in it; otherwise answer from general knowledge.';

  const userContent = pageText && pageText.trim()
    ? `Page content:\n"""\n${pageText.slice(0, 6000)}\n"""\n\nQuestion: ${q}`
    : q;

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.5,
        max_tokens: style === 'detailed' ? 900 : style === 'concise' ? 200 : 500
      })
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      throw new Error((data && data.error && data.error.message) || ('Groq request failed with status ' + upstream.status));
    }

    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    res.status(200).json({ reply: reply.trim() });
  } catch (err) {
    res.status(502).json({
      error: 'AI backend unavailable',
      detail: (err && err.message) || String(err)
    });
  }
}
