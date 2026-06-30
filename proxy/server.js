const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY; // from serper.dev — free tier 2,500 searches/month
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

if (!GROQ_API_KEY) {
  console.error('ERROR: GROQ_API_KEY environment variable is not set.');
  process.exit(1);
}
if (!SERPER_API_KEY) {
  console.warn('WARNING: SERPER_API_KEY is not set — web search will be disabled, falling back to LLM-only mode.');
}

function getCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? (origin || '*') : 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function httpsRequestJSON(options, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpsGetText(targetUrl, maxBytes = 15000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(targetUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StartupScoutBot/1.0; +https://github.com)',
          'Accept': 'text/html',
        },
        timeout: 6000,
      };
      const req = https.request(options, (res) => {
        // Follow one redirect
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          httpsGetText(res.headers.location, maxBytes).then(resolve);
          return;
        }
        let data = '';
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size < maxBytes) data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, html: data }));
      });
      req.on('error', () => resolve({ status: 0, html: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, html: '' }); });
      req.end();
    } catch {
      resolve({ status: 0, html: '' });
    }
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Serper.dev web search (supports pagination up to page 8) ──
async function serperSearch(query, num = 10, page = 1) {
  if (!SERPER_API_KEY) return [];
  const payload = JSON.stringify({ q: query, num, page });
  const options = {
    hostname: 'google.serper.dev',
    path: '/search',
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  try {
    const { body } = await httpsRequestJSON(options, payload);
    const organic = body.organic || [];
    return organic.map(r => ({ title: r.title, link: r.link, snippet: r.snippet }));
  } catch (e) {
    console.error('Serper search error:', e.message);
    return [];
  }
}

// ── Groq chat completion ──
async function groqChat(messages, model = 'llama-3.3-70b-versatile', maxTokens = 4000) {
  const payload = JSON.stringify({ model, max_tokens: maxTokens, messages });
  const options = {
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  const { status, body } = await httpsRequestJSON(options, payload);
  if (status !== 200) throw new Error(`Groq error ${status}: ${JSON.stringify(body).slice(0,300)}`);
  return body.choices?.[0]?.message?.content || '';
}

// ── Route: /v1/chat/completions — plain passthrough (no search) ──
async function handlePlainCompletion(requestBody) {
  const model = requestBody.model || 'llama-3.3-70b-versatile';
  const messages = requestBody.messages || [];
  const content = await groqChat(messages, model, requestBody.max_tokens || 4000);
  return { choices: [{ message: { content } }] };
}

// ── Route: /v1/search-and-complete — grounded search + LLM ──
// Body: { query: "search terms", instruction: "what to extract from results", max_tokens }
async function handleSearchAndComplete(requestBody) {
  const { query, instruction, num_results = 6, fetch_pages = true, max_tokens = 4000 } = requestBody;
  if (!query) throw new Error('query is required');

  // 1. Real web search
  const results = await serperSearch(query, num_results);

  if (!results.length) {
    // No search available — fall back to plain LLM with a warning
    const content = await groqChat([
      { role: 'system', content: 'No web search results were available. Answer based on your training knowledge, but clearly note that results may be outdated.' },
      { role: 'user', content: instruction || query }
    ], 'llama-3.3-70b-versatile', max_tokens);
    return { choices: [{ message: { content } }], grounded: false };
  }

  // 2. Optionally fetch real page content for top results (grounding)
  let pageContents = [];
  if (fetch_pages) {
    const topResults = results.slice(0, 5);
    const fetches = await Promise.all(topResults.map(async (r) => {
      const page = await httpsGetText(r.link, 12000);
      const text = page.html ? stripHtml(page.html).slice(0, 2000) : '';
      return { ...r, pageText: text, live: page.status >= 200 && page.status < 400 };
    }));
    pageContents = fetches;
  } else {
    pageContents = results.map(r => ({ ...r, pageText: '', live: null }));
  }

  // 3. Build grounded context for the LLM
  const context = pageContents.map((r, i) =>
    `[Source ${i+1}] ${r.title}\nURL: ${r.link}\nLive: ${r.live === null ? 'unknown' : r.live ? 'yes' : 'NO - site unreachable'}\nSnippet: ${r.snippet || ''}\nPage content excerpt: ${r.pageText || '(not fetched)'}\n`
  ).join('\n---\n');

  const systemPrompt = `You are a research assistant with access to REAL, CURRENT web search results below. Use ONLY this grounded information — do not rely on prior knowledge about whether companies are active, as your training data may be outdated. If a source shows "Live: NO", treat that company as potentially inactive/unreachable and reflect this in your answer.`;

  const userPrompt = `${instruction || 'Summarize the following search results.'}

REAL SEARCH RESULTS (use this data, it is current as of now):
${context}`;

  const content = await groqChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 'llama-3.3-70b-versatile', max_tokens);

  return {
    choices: [{ message: { content } }],
    grounded: true,
    sources: pageContents.map(r => ({ title: r.title, url: r.link, live: r.live }))
  };
}

// ── Route: /v1/verify-companies — check which candidate names appear in first N pages of Google ──
// Body: { companyNames: [...], searchTerms: "context to search alongside each name", maxPages: 8 }
async function handleVerifyCompanies(requestBody) {
  const { companyNames, searchTerms = '', maxPages = 8 } = requestBody;
  if (!companyNames || !companyNames.length) throw new Error('companyNames array is required');

  const results = {};

  // For efficiency, batch-check each company with one targeted query rather than
  // paginating per company. We search "<company name> <context>" and check if
  // the company's own domain appears within the configured page depth.
  for (const name of companyNames) {
    const query = searchTerms ? `${name} ${searchTerms}` : name;
    let found = false;
    let foundUrl = null;
    let foundSnippet = null;
    let liveCheck = null;

    // Search page 1 first (cheapest, catches most real companies)
    const page1 = await serperSearch(query, 10, 1);
    const match = page1.find(r => {
      const titleMatch = r.title && r.title.toLowerCase().includes(name.toLowerCase().split(' ')[0]);
      const linkMatch = r.link && r.link.toLowerCase().includes(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
      return titleMatch || linkMatch;
    });

    if (match) {
      found = true;
      foundUrl = match.link;
      foundSnippet = match.snippet;
    } else if (maxPages > 1) {
      // Not found on page 1 — check up to maxPages for a real mention (rate-limit friendly: stop at first hit)
      for (let p = 2; p <= Math.min(maxPages, 8); p++) {
        const pageResults = await serperSearch(query, 10, p);
        if (!pageResults.length) break; // no more results available
        const m = pageResults.find(r => {
          const titleMatch = r.title && r.title.toLowerCase().includes(name.toLowerCase().split(' ')[0]);
          const linkMatch = r.link && r.link.toLowerCase().includes(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
          return titleMatch || linkMatch;
        });
        if (m) { found = true; foundUrl = m.link; foundSnippet = m.snippet; break; }
      }
    }

    // If found, do a quick liveness check on the URL
    if (found && foundUrl) {
      const page = await httpsGetText(foundUrl, 3000);
      liveCheck = page.status >= 200 && page.status < 400;
    }

    results[name] = { found, url: foundUrl, snippet: foundSnippet, live: liveCheck };
  }

  return { results };
}

const server = http.createServer((req, res) => {
  const origin = req.headers['origin'] || '';
  const cors = getCorsHeaders(origin);

  console.log(`${req.method} ${req.url} from ${origin || 'unknown'}`);

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      message: 'Startup Scout proxy is running',
      web_search: SERPER_API_KEY ? 'enabled' : 'disabled (set SERPER_API_KEY)',
      endpoints: ['/v1/chat/completions', '/v1/search-and-complete', '/v1/verify-companies'],
    }));
    return;
  }

  const isPlain = req.url === '/v1/chat/completions' || req.url === '/chat/completions';
  const isGrounded = req.url === '/v1/search-and-complete';
  const isVerify = req.url === '/v1/verify-companies';

  if (req.method !== 'POST' || (!isPlain && !isGrounded && !isVerify)) {
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      received: { method: req.method, url: req.url },
      expected: 'POST /v1/chat/completions, /v1/search-and-complete, or /v1/verify-companies'
    }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    let requestBody;
    try { requestBody = JSON.parse(body); }
    catch {
      res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    try {
      let result;
      if (isGrounded) {
        console.log(`Grounded search: "${requestBody.query}"`);
        result = await handleSearchAndComplete(requestBody);
      } else if (isVerify) {
        console.log(`Verifying ${requestBody.companyNames?.length || 0} companies, maxPages=${requestBody.maxPages||8}`);
        result = await handleVerifyCompanies(requestBody);
      } else {
        result = await handlePlainCompletion(requestBody);
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('Handler error:', err.message);
      res.writeHead(502, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  req.on('error', (err) => console.error('Request error:', err.message));
});

server.listen(PORT, () => {
  console.log(`Startup Scout proxy running on port ${PORT}`);
  console.log(`Groq key: ${GROQ_API_KEY ? '✓ set' : '✗ MISSING'}`);
  console.log(`Serper key: ${SERPER_API_KEY ? '✓ set (web search enabled)' : '✗ not set (web search disabled)'}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
