const https = require('https');
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Allowed origins — set to your GitHub Pages URL
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

if (!GROQ_API_KEY) {
  console.error('ERROR: GROQ_API_KEY environment variable is not set.');
  process.exit(1);
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? (origin || '*') : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const server = http.createServer((req, res) => {
  const origin = req.headers['origin'] || '';
  const headers = corsHeaders(origin);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  // Only allow POST to /v1/chat/completions
  const parsed = url.parse(req.url);
  if (req.method !== 'POST' || parsed.pathname !== '/v1/chat/completions') {
    res.writeHead(404, { ...headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Only POST /v1/chat/completions is supported.' }));
    return;
  }

  // Collect request body
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // Validate JSON
    let parsed_body;
    try {
      parsed_body = JSON.parse(body);
    } catch {
      res.writeHead(400, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    // Forward to Groq
    const payload = JSON.stringify(parsed_body);
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

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        ...headers,
        'Content-Type': 'application/json',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message);
      res.writeHead(502, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream error: ' + err.message }));
    });

    proxyReq.write(payload);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`Startup Scout proxy running on port ${PORT}`);
  console.log(`Groq key: ${GROQ_API_KEY ? '✓ set' : '✗ MISSING'}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
