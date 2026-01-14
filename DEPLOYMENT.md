# Deployment Guide

This guide will help you deploy the City of Kingston 311 Chatbot to Vercel (frontend) and Railway (backend).

## Prerequisites

- GitHub account
- Vercel account (sign up at https://vercel.com)
- Railway account (sign up at https://railway.app)
- Pinecone API key
- OpenAI API key

## Step 1: Deploy Backend to Railway

1. **Go to Railway Dashboard**
   - Visit https://railway.app
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository: `sapkota-aayush/311`

2. **Configure the Service**
   - Railway will detect the `Procfile` automatically
   - Set the root directory to `/backend` (or keep root and update Procfile path)
   - Add environment variables:
     - `PINECONE_API_KEY` - Your Pinecone API key
     - `OPENAI_API_KEY` - Your OpenAI API key
     - `PORT` - Railway sets this automatically, but you can set it to `8000`

3. **Deploy**
   - Railway will automatically build and deploy
   - Once deployed, copy your Railway app URL (e.g., `https://your-app.up.railway.app`)

## Step 2: Deploy Frontend to Vercel

1. **Go to Vercel Dashboard**
   - Visit https://vercel.com
   - Click "Add New Project"
   - Import your GitHub repository: `sapkota-aayush/311`

2. **Configure Build Settings**
   - Framework Preset: Create React App
   - Root Directory: `frontend`
   - Build Command: `npm run build`
   - Output Directory: `build`
   - Install Command: `npm install`

3. **Add Environment Variables**
   - `REACT_APP_API_URL` - Your Railway backend URL (e.g., `https://your-app.up.railway.app`)
   - Do NOT include `/query` in the URL - the frontend adds that automatically

4. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy your frontend
   - Once deployed, you'll get a URL like `https://your-app.vercel.app`

## Step 3: Update Backend CORS

After deploying the frontend, update Railway environment variables:

1. Go back to Railway dashboard
2. Add/Update environment variable:
   - `ALLOWED_ORIGINS` - Your Vercel URL (e.g., `https://your-app.vercel.app`)
   - You can add multiple origins separated by commas
3. Railway will automatically redeploy with the new CORS settings

## Step 4: Test Your Deployment

1. Visit your Vercel URL
2. Try asking a question like "How do I apply for a parking permit?"
3. Check browser console for any errors
4. Check Railway logs if backend isn't responding

## Troubleshooting

### Backend Issues

- **500 Errors**: Check Railway logs for missing environment variables
- **CORS Errors**: Make sure `ALLOWED_ORIGINS` includes your Vercel URL
- **Connection Refused**: Verify Railway service is running and URL is correct

### Frontend Issues

- **API Not Found**: Check `REACT_APP_API_URL` is set correctly in Vercel
- **Build Failures**: Check Vercel build logs for dependency issues
- **Blank Page**: Check browser console for JavaScript errors

## Environment Variables Summary

### Railway (Backend)
- `PINECONE_API_KEY` - Required
- `OPENAI_API_KEY` - Required
- `ALLOWED_ORIGINS` - Your Vercel URL(s), comma-separated
- `PORT` - Auto-set by Railway

### Vercel (Frontend)
- `REACT_APP_API_URL` - Your Railway backend URL (without `/query`)

## Updating After Deployment

1. Push changes to GitHub
2. Railway and Vercel will automatically redeploy
3. Check deployment logs if issues occur

## Cost Considerations

- **Railway**: Free tier includes $5/month credit
- **Vercel**: Free tier includes unlimited deployments
- **Pinecone**: Free tier available
- **OpenAI**: Pay-as-you-go (very affordable for this use case)
