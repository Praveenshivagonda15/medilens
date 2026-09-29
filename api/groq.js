/**
 * api/groq.js  -  Vercel serverless proxy for Groq API calls
 * Keys from env vars: GROQ_KEY_1, GROQ_KEY_2, GROQ_KEY_3, etc.
 * 
 * Uses ESM (export default) because package.json has "type": "module"
 */

const API_KEYS = [
  process.env.GROQ_KEY_1,
  process.env.GROQ_KEY_2,
  process.env.GROQ_KEY_3,
  process.env.GROQ_KEY_4,
  process.env.GROQ_KEY_5,
  process.env.GROQ_KEY,
].filter(Boolean)

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

function isValidPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || typeof lastMsg !== 'object') return false;

  let textContent = '';
  if (typeof lastMsg.content === 'string') {
    textContent = lastMsg.content;
  } else if (Array.isArray(lastMsg.content)) {
    const textObj = lastMsg.content.find(item => item && item.type === 'text');
    if (textObj && typeof textObj.text === 'string') {
      textContent = textObj.text;
    }
  }

  const lowerCleaned = textContent.trim().toLowerCase();
  
  const APPROVED_PREFIXES = [
    "medicine label reader.",
    "medical prescription reader.",
    "you are an indian pharmacological api.",
    "indian patient medicine info.",
    "you are an indian pharmacist.",
    "translate each item in this json array to"
  ];

  return APPROVED_PREFIXES.some(prefix => lowerCleaned.startsWith(prefix));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  if (!API_KEYS.length) {
    res.status(500).json({ error: 'No GROQ_KEY_* configured in Vercel env vars' }); return
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { res.status(400).json({ error: 'Invalid JSON' }); return }
  }
  if (!body || typeof body !== 'object') {
    try {
      const raw = await new Promise((resolve, reject) => {
        let data = ''
        req.on('data', chunk => data += chunk)
        req.on('end', () => resolve(data))
        req.on('error', reject)
      })
      body = JSON.parse(raw)
    } catch { res.status(400).json({ error: 'Could not parse body' }); return }
  }

  const { model, max_tokens, temperature, messages } = body
  if (!model || !messages) {
    res.status(400).json({ error: 'Missing model or messages' }); return
  }

  // Validate prompt prefix to prevent API key abuse
  if (!isValidPrompt(messages)) {
    res.status(400).json({ error: 'Prompt validation failed: prompt not approved for execution.' }); return
  }

  const payload = { model, max_tokens: max_tokens || 1000, temperature: temperature ?? 0.1, messages }

  let lastError = 'Unknown error'
  
  for (const key of API_KEYS) {
    try {
      const upstream = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      })

      if (upstream.status === 429) { lastError = 'Rate limited'; continue }
      if (upstream.status === 401) { lastError = 'Invalid API key'; continue }
      if (upstream.status === 404) { lastError = 'Model decommissioned'; continue }

      const data = await upstream.json()
      res.status(upstream.status).json(data); return
    } catch (err) {
      lastError = err.message
    }
  }

  res.status(500).json({ error: 'All keys failed', detail: lastError })
}