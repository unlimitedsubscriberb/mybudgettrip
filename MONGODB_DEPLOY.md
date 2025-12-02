# MongoDB Atlas + Render Deployment Guide

## Part 1: Set Up MongoDB Atlas (Free Database)

### Step 1: Create MongoDB Atlas Account
1. Go to [https://www.mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register)
2. Sign up with Google/GitHub or email (FREE - no credit card required)
3. Choose **M0 FREE** tier when prompted

### Step 2: Create a Cluster
1. After signup, click **"Build a Database"**
2. Select **M0 FREE** tier (512MB storage)
3. Choose a cloud provider (AWS recommended) and region closest to you
4. Click **"Create"** (takes 1-3 minutes)

### Step 3: Create Database User
1. Click **"Database Access"** in left sidebar
2. Click **"Add New Database User"**
3. Choose **"Password"** authentication
4. Username: `tripbudget` (or any name you like)
5. Password: Click **"Autogenerate Secure Password"** and **COPY IT**
6. User Privileges: Select **"Read and write to any database"**
7. Click **"Add User"**

### Step 4: Whitelist IP Address
1. Click **"Network Access"** in left sidebar
2. Click **"Add IP Address"**
3. Click **"Allow Access from Anywhere"** (for Render deployment)
4. Click **"Confirm"**

### Step 5: Get Connection String
1. Click **"Database"** in left sidebar
2. Click **"Connect"** button on your cluster
3. Select **"Connect your application"**
4. Copy the connection string (looks like this):
   ```
   mongodb+srv://tripbudget:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. **IMPORTANT**: Replace `<password>` with the password you copied in Step 3
6. **IMPORTANT**: Add database name before the `?`, like this:
   ```
   mongodb+srv://tripbudget:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/trip-budget-manager?retryWrites=true&w=majority
   ```

---

## Part 2: Deploy to Render

### Step 1: Push Code to GitHub
```bash
# In your project folder
git add .
git commit -m "Add MongoDB support"
git push origin main
```

### Step 2: Set Up Render
1. Go to [https://render.com](https://render.com)
2. Sign up/Login with GitHub
3. Click **"New +"** → **"Web Service"**
4. Connect your GitHub repository
5. Select your `rahul` repository

### Step 3: Configure Web Service
Fill in these settings:
- **Name**: `trip-budget-manager` (or any name)
- **Region**: Choose closest to you
- **Branch**: `main`
- **Root Directory**: Leave empty
- **Runtime**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `node server/server.js`
- **Instance Type**: **Free**

### Step 4: Add Environment Variable
1. Scroll down to **"Environment Variables"**
2. Click **"Add Environment Variable"**
3. **Key**: `MONGODB_URI`
4. **Value**: Paste your MongoDB connection string from Part 1, Step 5
   ```
   mongodb+srv://tripbudget:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/trip-budget-manager?retryWrites=true&w=majority
   ```
5. Click **"Add"**

### Step 5: Deploy
1. Click **"Create Web Service"**
2. Wait 2-5 minutes for deployment
3. Your app will be live at: `https://trip-budget-manager.onrender.com`

---

## Part 3: Verify It Works

1. Open your Render URL
2. Create a new trip
3. Add some members and expenses
4. **Wait 15 minutes** (Render free tier sleeps after inactivity)
5. Visit the URL again
6. **Your data should still be there!** ✅

---

## Troubleshooting

### "MongooseServerSelectionError"
- Check your MongoDB connection string is correct
- Verify you replaced `<password>` with actual password
- Ensure IP whitelist includes "Allow from Anywhere"

### "Cannot find module './models/Trip'"
- Make sure you committed and pushed the `server/models/Trip.js` file
- Check the file exists in your GitHub repository

### App works locally but not on Render
- Verify `MONGODB_URI` environment variable is set in Render
- Check Render logs for specific error messages

---

## Local Development

To test locally with MongoDB:

1. **Option A: Use MongoDB Atlas** (recommended)
   ```bash
   # Set environment variable (Windows PowerShell)
   $env:MONGODB_URI="mongodb+srv://tripbudget:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/trip-budget-manager?retryWrites=true&w=majority"
   npm start
   ```

2. **Option B: Install MongoDB locally**
   ```bash
   # The app will use default: mongodb://localhost:27017/trip-budget-manager
   npm start
   ```

---

## What Changed?

✅ **Before**: Data stored in `server/data.json` (lost on Render restart)  
✅ **After**: Data stored in MongoDB Atlas (persists forever)  
✅ **Client code**: No changes needed - works exactly the same!

Your data is now safe and will never be lost! 🎉
