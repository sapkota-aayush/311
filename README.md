# City of Kingston 311 Chatbot

A RAG-powered chatbot for answering City of Kingston 311 questions using Pinecone and OpenAI.

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

## Quick Start

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

4. Run the server:
```bash
python main.py
```

Backend runs on `http://localhost:8000`

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
npm start
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
