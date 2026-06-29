# Startup Scout — Proxy Server

A lightweight Node.js proxy that forwards LLM requests to Groq server-side, so your API key is never exposed to the browser.

## How it works

```
Team's browser → This proxy (Render) → Groq API
                 (GROQ_API_KEY stored
                  as env variable here)
```

## Deploy to Render (free, 5 minutes)

1. Push this `proxy/` folder to a GitHub repo (can be the same repo as the frontend, in a subfolder, or a separate repo)

2. Go to [render.com](https://render.com) → **New → Web Service**

3. Connect your GitHub repo

4. Configure:
   - **Name:** `startup-scout-proxy`
   - **Root Directory:** `proxy` (if in a subfolder) or leave blank
   - **Runtime:** `Node`
   - **Build Command:** *(leave blank)*
   - **Start Command:** `node server.js`
   - **Instance Type:** Free

5. Add environment variables:
   - `GROQ_API_KEY` = your Groq API key
   - `ALLOWED_ORIGINS` = `https://YOUR_USERNAME.github.io` (your GitHub Pages URL)

6. Click **Create Web Service**

7. Render gives you a URL like `https://startup-scout-proxy.onrender.com`

## Update the frontend

In `index.html`, the LLM Settings tab will be hidden from users.
Set the proxy URL as the default endpoint — see the frontend README for instructions,
or just update the `PROXY_URL` constant at the top of the `<script>` in `index.html`:

```js
const PROXY_URL = 'https://startup-scout-proxy.onrender.com';
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | ✅ Yes | Your Groq API key |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated list of allowed origins (e.g. `https://yourname.github.io`). Defaults to `*` (all origins). |
| `PORT` | No | Port to listen on. Render sets this automatically. |

## Security notes

- The proxy only accepts `POST /v1/chat/completions` — all other routes return 404
- The API key is stored as a Render environment variable, never in code or git history
- Set `ALLOWED_ORIGINS` to your exact GitHub Pages URL to prevent other sites from using your proxy
