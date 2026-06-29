const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

if (!GROQ_API_KEY) {
  console.error('ERROR: GROQ_API_KEY environment variable is not set.');
  process.exit(1);
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

const server = http.createServer((req, res) => {
  const origin = req.headers['origin'] || '';
  const cors = getCorsHeaders(origin);

  console.log(`${req.method} ${req.url} from ${origin || 'unknown'}`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Startup Scout proxy is running' }));
    return;
  }

  // Accept POST to /v1/chat/completions OR /chat/completions (both work)
  const isCompletions = req.url === '/v1/chat/completions' || req.url === '/chat/completions';

  if (req.method !== 'POST' || !isCompletions) {
    console.log(`404: method=${req.method} url=${req.url}`);
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Not found',
      received: { method: req.method, url: req.url },
      expected: 'POST /v1/chat/completions'
    }));
    return;
  }

  // Collect body
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let requestBody;
    try {
      requestBody = JSON.parse(body);
    } catch {
      res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    // Force model to one that works on Groq free tier
    requestBody.model = requestBody.model || 'llama-3.3-70b-versatile';

    const payload = JSON.stringify(requestBody);

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

    console.log(`Forwarding to Groq: model=${requestBody.model}`);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log(`Groq responded: ${proxyRes.statusCode}`);
      res.writeHead(proxyRes.statusCode, {
        ...cors,
        'Content-Type': 'application/json',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Groq request error:', err.message);
      res.writeHead(502, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream error: ' + err.message }));
    });

    proxyReq.write(payload);
    proxyReq.end();
  });

  req.on('error', (err) => {
    console.error('Request error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`Startup Scout proxy running on port ${PORT}`);
  console.log(`Groq key: ${GROQ_API_KEY ? '✓ set (' + GROQ_API_KEY.slice(0,8) + '...)' : '✗ MISSING'}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
