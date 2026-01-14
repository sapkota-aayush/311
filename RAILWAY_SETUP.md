# Railway Deployment Setup Guide

## Step 1: Create New Railway Service

1. Go to Railway dashboard
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your repository: `sapkota-aayush/311`
4. Railway will create a new service

## Step 2: Configure Root Directory

1. Go to your service → **Settings**
2. Scroll to **Root Directory**
3. Set it to: `backend`
4. Click **Save**

This tells Railway to use the `backend/` folder as the project root.

## Step 3: Set Environment Variables

Go to your service → **Variables** tab and add:

### Required Variables:

1. **PINECONE_API_KEY**
   - Value: Your Pinecone API key

2. **OPENAI_API_KEY**
   - Value: Your OpenAI API key

3. **ALLOWED_ORIGINS**
   - Value: `*` (for testing) or your Vercel URL
   - Example: `https://your-app.vercel.app`
   - Or use wildcard: `*` (allows all origins - for testing only)

## Step 4: Verify Configuration Files

The following files should be in your repo:

- `backend/main.py` - Your FastAPI application
- `backend/requirements.txt` - Python dependencies
- `backend/runtime.txt` - Python version (python-3.11.9)
- `railway.json` - Railway configuration (start command)
- `Procfile` - Alternative start command

## Step 5: Deploy

Railway will automatically deploy when you:
- Connect the GitHub repo
- Set the root directory
- Add environment variables

## Step 6: Get Your Backend URL

1. Go to your service → **Settings** → **Networking**
2. Copy the **Public URL** (e.g., `https://your-service.up.railway.app`)
3. This is your backend URL

## Step 7: Configure Vercel

In Vercel dashboard → **Settings** → **Environment Variables**:

- **Name:** `REACT_APP_API_URL`
- **Value:** Your Railway backend URL (from Step 6)
- **Environments:** Select all (Production, Preview, Development)

## Troubleshooting

### If deployment fails:
- Check Railway logs for errors
- Verify root directory is set to `backend`
- Verify all environment variables are set
- Check that `requirements.txt` and `runtime.txt` exist in `backend/` folder

### If CORS errors:
- Make sure `ALLOWED_ORIGINS` includes your Vercel URL
- Or set it to `*` for testing
- Wait for Railway to redeploy after changing variables

### If backend won't start:
- Check Railway logs
- Verify `uvicorn` is in `requirements.txt`
- Verify the start command in `railway.json` is correct
