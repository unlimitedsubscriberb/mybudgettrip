# How to Deploy Trip Budget Manager Online (Free)

This guide will help you deploy your application to **Render.com** for free.

## Prerequisites
1. **Install Git**:
   - Download and install Git from [git-scm.com](https://git-scm.com/downloads).
   - During installation, choose "Use Git from the Windows Command Prompt" (recommended).
   - After installing, restart your terminal (or VS Code) and type `git --version` to verify.
2. **GitHub Account**: Create a free account at [github.com](https://github.com).
3. **Render Account**: Create a free account at [render.com](https://render.com).

## Step 1: Push to GitHub
1. Initialize Git (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Ready for deployment"
   ```
2. Create a new repository on GitHub.
3. Link your local project to GitHub:
   ```bash
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```

## Step 2: Deploy on Render
1. Go to [Render.com](https://render.com) and log in.
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository.
4. Configure the service:
   - **Name**: `trip-budget-manager` (or any name you like)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
5. Click **Create Web Service**.

## Step 3: Keep It Alive (Important!)
Render's free tier sleeps after 15 minutes of inactivity.
- **Automatic**: I have added a script to your server that pings itself every 14 minutes when running on Render.
- **Backup**: Use [UptimeRobot](https://uptimerobot.com) to ping your app URL (`https://your-app.onrender.com/api/trip`) every 5 minutes.

## Step 4: Custom Domain (Optional)
If you own a domain (e.g., `yourname.com`), you can link it to your Render app:
1. Go to your Render Dashboard -> Select your Web Service.
2. Click on **Settings** -> Scroll down to **Custom Domains**.
3. Click **Add Custom Domain** and enter your domain name (e.g., `www.yourname.com`).
4. Render will show you DNS records (CNAME or A record) to add to your domain provider (GoDaddy, Namecheap, etc.).
5. Log in to your domain provider, go to DNS Settings, and add the records shown by Render.
6. Wait for verification (can take a few minutes to 24 hours).
7. Render automatically provisions a free SSL certificate (HTTPS) for your domain.

## Note on Data
Since this uses free hosting without a database, **your data (trips, members, expenses) will be reset if the server restarts**.
For permanent storage, you would need to connect a database like MongoDB Atlas (free tier available).
