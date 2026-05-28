# Starpush Deployment Guide

## Quick Render Deploy (1 Click - RECOMMENDED)

1. Go to: https://dashboard.render.com/
2. Click "New +" → "Web Service"
3. Select "Build and deploy from a Git repository"
4. Connect your GitHub account
5. Create a new GitHub repo named `starpush` and push this code
6. Set these environment variables in Render:
   - `ANTHROPIC_API_KEY` = Your Anthropic API key (from https://console.anthropic.com)
   - `NODE_ENV` = production
   - `PORT` = 3000 (Render handles this automatically)

Optional (for SMS):
   - `TWILIO_ACCOUNT_SID` = From https://console.twilio.com
   - `TWILIO_AUTH_TOKEN` = From https://console.twilio.com
   - `TWILIO_PHONE_NUMBER` = Your Twilio number
   - `DEFAULT_REVIEW_LINK` = Your Google review link

7. Click "Deploy"
8. Your live URL will appear in the Render dashboard

---

## Push to GitHub

```bash
cd "/Users/skelemer/Desktop/Files/Projects & Code/b2b seo"

# Create new GitHub repo at https://github.com/new
# Name it: starpush

git remote set-url origin https://github.com/YOUR_USERNAME/starpush.git
git add .
git commit -m "Initial Starpush deployment"
git push -u origin main
```

---

## Environment Variables Required

**Minimum (AI features will work):**
- `ANTHROPIC_API_KEY` - Get from https://console.anthropic.com

**Optional (SMS review requests):**
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `DEFAULT_REVIEW_LINK`

---

## Features Included

✅ Landing page with features & pricing
✅ User signup with form validation
✅ GBP Optimizer (AI-powered Google Business Profile audit)
✅ Dashboard with activity feed
✅ Review management with AI replies
✅ SMS review request automation (Twilio)
✅ Fully responsive design

---

## Server Routes

- `GET /` - Landing page
- `GET /dashboard` - Main dashboard
- `GET /signup` - Signup page
- `GET /optimize` - GBP Optimizer tool
- `POST /api/signup` - Create account
- `POST /api/optimize` - Run GBP analysis
- `POST /api/send-request` - Send SMS review request
- `POST /api/webhook/review` - Receive review (webhook)
- `GET /api/feed` - Activity feed
- `GET /api/leads` - View leads (admin)
- `GET /health` - Health check

---

## Local Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Server will start on http://localhost:3000
```

---

## Support

For API key issues:
- Anthropic: https://console.anthropic.com
- Twilio: https://console.twilio.com
