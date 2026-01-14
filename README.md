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
│   │   │   └── ChatInterface.js
│   │   └── index.js
│   └── package.json
├── extract_sources.py    # Extract content from City pages
├── pinecone_integration.py  # Upload data to Pinecone
└── waste_collection_all.json  # Extracted data
```

## Setup

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set environment variables:
```bash
export PINECONE_API_KEY='your-pinecone-key'
export OPENAI_API_KEY='your-openai-key'
```

4. Run the server:
```bash
python main.py
# Or: uvicorn main:app --reload --port 8000
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

3. Start the development server:
```bash
npm start
```

Frontend runs on `http://localhost:3000`

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
