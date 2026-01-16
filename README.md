# City of Kingston 311 Assistant

A web app that answers City of Kingston service questions using **RAG (Pinecone + OpenAI)** and (when needed) **official, allowlisted sources**. It also includes a **Latest Information** page, optional **voice (Whisper STT + TTS)**, and a **Report** button to share feedback on answers (no backend required for reporting).

## Live Demo

- **Frontend**: `https://cityofkingston.aayussh.com/`

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

## Environment Variables

See [ENV_SETUP.md](./ENV_SETUP.md) for complete environment variable setup guide.
