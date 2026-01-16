# City of Kingston 311 Assistant

A web app that answers City of Kingston service questions using **RAG (Pinecone + OpenAI)** and (when needed) **official, allowlisted sources**. It also includes a **Latest Information** page, optional **voice (Whisper STT + TTS)**, and a **Report** button to share feedback on answers (no backend required for reporting).

## Live Demo

- **Frontend**: `https://cityofkingston.aayussh.com/`

## Demo Video

- **YouTube**: `https://youtu.be/jNWdu4AaBdM`
- **Script + judging checklist**: see [`VIDEO.md`](./VIDEO.md)

## Project Structure

```
CityOfKingston/
├── backend/          # FastAPI backend
│   ├── main.py      # API server
│   └── requirements.txt
├── frontend/         # React frontend
│   ├── src/
│   │   ├── App.js
│   │   ├── components/
│   │   │   ├── ChatInterface.js
│   │   │   └── LandingPage.js
│   │   └── index.js
│   └── package.json
├── DEPLOYMENT.md     # Deployment guide for Vercel & Railway
├── ENV_SETUP.md      # Environment variables setup guide
└── README.md         # This file
```

## Features

- **Chat with official sources**: Responses show **Official Sources** links (except greetings).
- **Latest Information**: A curated “Latest Information” page (currently showing **2026** items).
- **Voice**:
  - **Speech-to-text** via `/audio/transcribe` (Whisper)
  - **Text-to-speech** via `/audio/speak` (OpenAI TTS)
- **Report a response**: “Report” button on bot messages creates a shareable payload (copy/download).
- **Desktop-friendly UI**: Wider, clean layout for screen recording.

## Architecture (RAG + official dynamic lookup)

This app has two answer paths:

- **STATIC (RAG / “policy knowledge base”)**: best for stable city info (bylaws, permits, taxes, waste rules, etc.)
- **DYNAMIC (official-site lookup)**: best for time-sensitive info (road closures, snow/winter parking, transit alerts, lost & found, etc.)

### Frontend (React) request/response flow

- **Chat UI**: `frontend/src/components/ChatInterface.js`
- **Streaming endpoint used by the UI**: `POST /query/stream`

The frontend expects a **server-sent events (SSE)** style stream where each line is:

- `data: {"type":"results","results":[...]}`
- `data: {"type":"text","content":"..."}`
- `data: {"type":"done"}`

Important detail: the backend sends **`type: "results"` early** (before the model finishes streaming) so the UI can always render “Official Sources” reliably.

### Backend router (dynamic vs RAG)

Backend entrypoint: `backend/main.py`

At a high level, `POST /query/stream` does:

1. **Language handling**
   - If the user selected French, the query is translated to English for retrieval (RAG content is English), then the final answer is returned in French.
2. **Greeting short-circuit**
   - Greetings return a short response and **do not include sources**.
3. **Dynamic router**
   - `is_dynamic_query()` / `classify_dynamic_bucket()` routes time-sensitive topics into buckets like:
     - `road_closures`, `snow_removal`, `transit`, `transit_lost_found`, `lost_found_general`
4. **RAG route**
   - Everything else goes through embeddings + Pinecone retrieval.

### STATIC path (RAG / Pinecone)

- **Embeddings model**: `text-embedding-3-small`
- **Vector DB**: Pinecone index hardcoded as `kingston-policies`
- **What’s stored in Pinecone metadata** (used in responses):
  - `content` (scraped text chunk)
  - `category` / `topic`
  - `source_url`
  - optional update fields like `lastmod` / `updated_at`

Flow:

1. Create embedding for the user query
2. Query Pinecone for top matches (the backend queries `top_k * 3` and then post-processes)
3. `_select_context_and_results()`:
   - normalizes categories
   - cleans boilerplate (menus, nav text)
   - dedupes by `source_url`
   - builds:
     - `context_parts` (fed to the LLM)
     - `formatted_results` (sent to UI as “Official Sources”)
4. `_ensure_official_links_for_category()`:
   - guarantees at least **one official link** even if a Pinecone record is missing `source_url`
5. `_annotate_results_lastmod()`:
   - attaches `lastmod` (when possible) so the UI can show **“Updated YYYY-MM-DD”**

### DYNAMIC path (official-site lookup)

Dynamic lookup is **restricted to an allowlist** (`ALLOWED_DYNAMIC_DOMAINS`) to prevent non-official sources.

How sources are selected:

- Uses a cached City sitemap (`SITEMAP_URL`, TTL via `SITEMAP_TTL_SECONDS`)
- Combines:
  - curated “hub” pages (`CURATED_DYNAMIC_SOURCES`)
  - keyword-matched URLs from the sitemap (URL scoring)
  - “latest” URLs for known patterns (e.g., traffic reports)

How the model is constrained:

- The backend fetches each selected URL, extracts readable text (`BeautifulSoup` + cleanup), and builds a numbered context block:
  - `[1] Title` + `URL: ...` + snippet
- The model is prompted: **“Answer using ONLY the official sources provided below”** and must cite `[1]`, `[2]`, etc.

### “Latest Information”

Current state: **curated frontend list** (prototype).

Target state: same dynamic machinery above (allowlisted sources + sitemap/feeds), refreshed every **15–60 minutes**, showing either:
- last **48 hours**, or
- most recent **N items** (e.g., 20)

## Quick Start (Local)

### Prerequisites
- Python 3.9+
- Node.js 16+
- Pinecone API key
- OpenAI API key

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set environment variables (see [ENV_SETUP.md](./ENV_SETUP.md) for details):
```bash
export PINECONE_API_KEY='your-pinecone-key'
export OPENAI_API_KEY='your-openai-key'
```

4. Run the server (recommended):
```bash
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Backend runs on `http://localhost:8000`
API docs: `http://localhost:8000/docs`

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Set environment variable (see [ENV_SETUP.md](./ENV_SETUP.md) for details):
```bash
export REACT_APP_API_URL='http://localhost:8000'
```

4. Start the development server:
```bash
BROWSER=none npm start
```

Frontend runs on `http://localhost:3000`

**📝 Important**: See [ENV_SETUP.md](./ENV_SETUP.md) for detailed environment variable configuration.

## API Endpoints

- `GET /` - Health check
- `GET /health` - Detailed health status
- `POST /query` - Query Pinecone for policy information
  ```json
  {
    "query": "garbage collection schedule",
    "top_k": 3
  }
  ```
- `POST /audio/transcribe` - Speech-to-text (Whisper)
- `POST /audio/speak` - Text-to-speech (MP3)

## Development

- Backend: FastAPI with Pinecone for vector search
- Frontend: React with axios for API calls
- Embeddings: OpenAI text-embedding-3-small
- Vector DB: Pinecone

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step instructions to deploy:
- Frontend to Vercel
- Backend to Railway

## Branch protection (recommended)

GitHub warns “Your main branch isn't protected” because `main` currently allows force-push/deletion and doesn’t require checks.

To protect it:
- GitHub → **Settings** → **Branches** → **Add branch protection rule**
- **Branch name pattern**: `main`
- Enable:
  - **Require a pull request before merging**
  - **Require status checks to pass before merging** (select Vercel check)
  - **Require conversation resolution**
  - **Restrict who can push to matching branches** (optional)
  - **Do not allow force pushes**
  - **Do not allow deletions**

## Environment Variables

See [ENV_SETUP.md](./ENV_SETUP.md) for complete environment variable setup guide.
