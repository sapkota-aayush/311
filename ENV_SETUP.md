# Environment Variables Setup

This project requires environment variables to be set. **Never commit actual `.env` files to git** - they contain secrets!

## Backend Environment Variables

Create a `.env` file in the `backend/` directory with:

```bash
PINECONE_API_KEY=your_pinecone_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### For Production (Railway):
Set these in Railway dashboard:
- `PINECONE_API_KEY` - Your Pinecone API key
- `OPENAI_API_KEY` - Your OpenAI API key  
- `ALLOWED_ORIGINS` - Your Vercel frontend URL (e.g., `https://your-app.vercel.app`)

## Frontend Environment Variables

Create a `.env.local` file in the `frontend/` directory with:

```bash
REACT_APP_API_URL=http://localhost:8000
```

### For Production (Vercel):
Set this in Vercel dashboard:
- `REACT_APP_API_URL` - Your Railway backend URL (e.g., `https://your-app.up.railway.app`)
  - **Note**: Do NOT include `/query` - the frontend adds that automatically

## Quick Setup for Local Development

### Backend:
```bash
cd backend
# Create .env file (copy the template above and fill in your keys)
export PINECONE_API_KEY='your_key'
export OPENAI_API_KEY='your_key'
python3 main.py
```

### Frontend:
```bash
cd frontend
# Create .env.local file (copy the template above)
# Or set environment variable:
export REACT_APP_API_URL='http://localhost:8000'
npm start
```

## Security Notes

- ✅ `.env` files are in `.gitignore` - they won't be committed
- ✅ Use `.env.example` files as templates (without real keys)
- ✅ Never share your API keys publicly
- ✅ Use different keys for development and production if possible
