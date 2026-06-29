# Startup Scout

An AI-powered startup scouting tool that runs entirely in your browser. Discover, research, and score startups against your investment brief — using any LLM provider you choose.

## Features

- **Two-agent pipeline** — a Search Agent discovers companies, a Scoring Agent independently evaluates fit
- **LLM-agnostic** — works with Anthropic (Claude), OpenAI (GPT-4o), Google Gemini, or any OpenAI-compatible endpoint (Groq, Together AI, Mistral, Ollama, etc.)
- **Word document upload** — upload a `.docx` brief and the tool auto-fills sectors, problem statement, and geography
- **File upload** — upload a CSV or Excel list of startups to score against your brief
- **Database integrations** — connect Crunchbase, Tracxn, Dealroom, or PitchBook API keys
- **Up to 50 results per run** — multi-batch search for broad coverage
- **Memory** — remembers previously scouted companies and excludes them from future runs
- **Export** — copy to Google Sheets (TSV) or download as CSV
- **Dark mode** — respects your system preference

## Setup

### Option 1 — Run locally
1. Download or clone this repository
2. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
3. No build step, no server, no dependencies to install

### Option 2 — Host on GitHub Pages
1. Fork or push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to `main` branch, `/ (root)` folder
4. Your tool will be live at `https://YOUR_USERNAME.github.io/startup-scout`

## Usage

1. **⚙ LLM Settings** — Enter your API key and choose a provider. Supported:
   - Anthropic: [console.anthropic.com](https://console.anthropic.com)
   - OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - Google Gemini: [aistudio.google.com](https://aistudio.google.com/app/apikey)
   - Groq (free tier): [console.groq.com](https://console.groq.com)
   - Any OpenAI-compatible endpoint: paste the base URL and model name

2. **Brief & Filters** — Enter your sectors, problem statement, geography, and filters. Or upload a `.docx` brief document to auto-fill.

3. **File Upload** *(optional)* — Upload a CSV/Excel list of startups to score against your brief.

4. **Database APIs** *(optional)* — Add Crunchbase, Tracxn, Dealroom, or PitchBook API keys for richer discovery.

5. Click **Scout startups** — the Search Agent discovers companies, then the Scoring Agent evaluates fit.

6. Export results to Google Sheets or CSV.

## How the two-agent pipeline works

```
Brief + Filters
      │
      ▼
┌─────────────────┐
│  SEARCH AGENT   │  Discovers real startups (name, website,
│                 │  location, founder, funding, stage…)
│  Multi-batch    │  across multiple search angles
└────────┬────────┘
         │  Raw company list
         ▼
┌─────────────────┐
│  SCORING AGENT  │  Evaluates each startup against your brief
│                 │  Assigns 1–5 fit score + written rationale
│  Batch scoring  │
└────────┬────────┘
         │  Scored & ranked results
         ▼
    Summary + Cards + Export
```

## Cost estimate (per 50-startup scout)

| Provider | Model | Estimated cost |
|---|---|---|
| Anthropic | claude-haiku-4-5 | ~$0.03–0.08 |
| OpenAI | gpt-4o-mini | ~$0.02–0.06 |
| Google | gemini-1.5-flash | ~$0.01–0.04 |
| Groq | llama-3.3-70b | ~$0.00–0.01 |

## Privacy

- Your API keys are stored in your browser's `localStorage` only
- No data is sent to any server other than the LLM provider you configure
- No analytics, no tracking, no backend

## License

MIT

## Team deployment (no API key for users)

See [`proxy/README.md`](proxy/README.md) for full instructions on deploying the proxy to Render.

**Quick summary:**
1. Deploy `proxy/` to Render as a Node.js web service
2. Set `GROQ_API_KEY` and `ALLOWED_ORIGINS` as environment variables in Render
3. Update `PROXY_URL` in `index.html` with your Render URL
4. Push to GitHub — team members open the tool and use it with no setup
