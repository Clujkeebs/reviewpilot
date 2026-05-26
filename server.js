require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'reviewpilot-dev-secret-change-in-production';

// ── Data persistence ─────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let users        = loadUsers();
const activityFeed = [];

// ── Stripe setup ──────────────────────────────────────────────────────────────
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(cookieParser());
// Raw body for Stripe webhooks BEFORE json parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth helpers ──────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}
function getUser(req) {
  try {
    const token = req.cookies.rp_token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    return users.find(u => u.id === decoded.id) || null;
  } catch { return null; }
}
function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.redirect('/login?next=' + encodeURIComponent(req.path));
  req.user = user;
  next();
}
function requireSubscription(req, res, next) {
  const user = req.user;
  const trialEnd = new Date(user.trialEndsAt);
  const isTrialActive = trialEnd > new Date();
  const isSubscribed = user.subscriptionStatus === 'active' || user.subscriptionStatus === 'trialing';
  if (isTrialActive || isSubscribed) return next();
  return res.redirect('/pricing?expired=1');
}

// ── Twilio SMS ────────────────────────────────────────────────────────────────
async function sendTwilioSMS(toNumber, messageBody) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) throw new Error('Twilio credentials not configured.');
  const url         = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: toNumber, From: fromNumber, Body: messageBody }).toString(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `Twilio error HTTP ${response.status}`);
  return data;
}

// ── Anthropic AI reply ────────────────────────────────────────────────────────
async function generateAIReply(reviewText, service, city, rating) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured.');
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message   = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 220,
    system: 'You are a professional operations manager for a local business. Write a friendly, 2-sentence reply to this customer review. Naturally include the city name and the service provided to boost local SEO. Do not sound like a robot. Do not use generic phrases like "We appreciate your feedback."',
    messages: [{ role: 'user', content: `Write a reply to this ${rating}-star Google review for our ${service || 'service'} in ${city || 'local area'}:\n\n"${reviewText}"` }],
  });
  return message.content[0].text;
}

// ── GBP Optimization ─────────────────────────────────────────────────────────
async function generateGBPOptimization({ businessName, category, city, services, currentDescription, website }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured.');
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userMsg   = [`Business Name: ${businessName}`, `Trade / GBP Category: ${category}`, `City: ${city}`, `Services Offered: ${services || 'Not specified'}`, `Current GBP Description: ${currentDescription || 'None provided'}`, `Website: ${website || 'Not provided'}`].join('\n');
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 4096,
    system: `You are a Google Business Profile (GBP) optimization expert and local SEO specialist with 10+ years of experience helping local service businesses rank #1 on Google Maps.\n\nAnalyze the business and return a comprehensive, specific, actionable optimization report.\n\nRULES:\n- Be specific — use the actual city, trade name, and service names in every recommendation\n- Use real, exact GBP category names as Google lists them\n- Every Q&A answer must mention the city and service naturally for local SEO\n- Google Posts must be 80-100 words, conversational, keyword-rich\n- Score based on what they told you: no description = low description score, etc.\n- Return ONLY valid JSON — no markdown, no code fences, no text outside the JSON\n\nRequired JSON structure (follow exactly):\n{\n  "score": { "overall": <0-100>, "description": <0-100>, "categories": <0-100>, "photos": <0-100>, "posts": <0-100>, "qanda": <0-100>, "verdict": "<2 sentences>" },\n  "optimizedDescription": "<250-300 char description>",\n  "descriptionKeywords": ["<kw>","<kw>","<kw>","<kw>","<kw>"],\n  "categories": { "primary": "<exact GBP category>", "additional": ["<cat>","<cat>","<cat>","<cat>"] },\n  "photoChecklist": [{"photo":"<desc>","priority":"Critical","why":"<why>"},{"photo":"<photo>","priority":"High","why":"<why>"},{"photo":"<photo>","priority":"High","why":"<why>"},{"photo":"<photo>","priority":"Medium","why":"<why>"},{"photo":"<photo>","priority":"Medium","why":"<why>"},{"photo":"<photo>","priority":"Medium","why":"<why>"}],\n  "qaTemplates": [{"question":"<q>","answer":"<a>"},{"question":"<q>","answer":"<a>"},{"question":"<q>","answer":"<a>"},{"question":"<q>","answer":"<a>"},{"question":"<q>","answer":"<a>"}],\n  "contentCalendar": [{"week":"Week 1","postType":"Offer","title":"<title>","body":"<80-100 word body>","cta":"<cta>"},{"week":"Week 2","postType":"Update","title":"<title>","body":"<body>","cta":"<cta>"},{"week":"Week 3","postType":"Tip","title":"<title>","body":"<body>","cta":"<cta>"},{"week":"Week 4","postType":"Highlight","title":"<title>","body":"<body>","cta":"<cta>"}],\n  "keywords": { "primary": ["<kw>","<kw>","<kw>"], "longTail": ["<kw>","<kw>","<kw>","<kw>"], "avoidTerms": ["<term>","<term>","<term>"], "replyTip": "<tip>" },\n  "completenessItems": [{"item":"<item>","priority":"Critical","howTo":"<howto>"},{"item":"<item>","priority":"High","howTo":"<howto>"},{"item":"<item>","priority":"High","howTo":"<howto>"},{"item":"<item>","priority":"High","howTo":"<howto>"},{"item":"<item>","priority":"Medium","howTo":"<howto>"},{"item":"<item>","priority":"Medium","howTo":"<howto>"},{"item":"<item>","priority":"Medium","howTo":"<howto>"}],\n  "quickWins": [{"action":"<action>","impact":"High","time":"5 min","why":"<why>"},{"action":"<action>","impact":"High","time":"<time>","why":"<why>"},{"action":"<action>","impact":"High","time":"<time>","why":"<why>"},{"action":"<action>","impact":"Medium","time":"<time>","why":"<why>"},{"action":"<action>","impact":"Medium","time":"<time>","why":"<why>"}]\n}`,
    messages: [{ role: 'user', content: userMsg }],
  });
  const raw   = message.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned unexpected format. Please try again.');
  return JSON.parse(match[0]);
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, businessName, trade, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase().trim())) {
    return res.status(409).json({ error: 'An account with that email already exists. Please log in.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const user = {
    id: 'u_' + Date.now(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash: hash,
    businessName: (businessName || '').trim(),
    trade: (trade || '').trim(),
    phone: (phone || '').trim(),
    plan: 'trial',
    trialEndsAt,
    subscriptionStatus: 'trialing',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveUsers(users);
  console.log(`[Signup] ${user.name} | ${user.email} | ${user.businessName}`);

  const token = signToken(user);
  res.cookie('rp_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

  // If Stripe configured, create checkout session
  if (stripe && req.body.plan && req.body.plan !== 'trial') {
    const priceIds = {
      starter: process.env.STRIPE_STARTER_PRICE_ID,
      growth:  process.env.STRIPE_GROWTH_PRICE_ID,
      pro:     process.env.STRIPE_PRO_PRICE_ID,
    };
    const priceId = priceIds[req.body.plan];
    if (priceId) {
      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          payment_method_types: ['card'],
          customer_email: user.email,
          line_items: [{ price: priceId, quantity: 1 }],
          subscription_data: { trial_period_days: 14 },
          success_url: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard?welcome=1`,
          cancel_url:  `${process.env.APP_URL || 'http://localhost:3000'}/pricing`,
          metadata: { userId: user.id },
        });
        return res.json({ success: true, stripeUrl: session.url });
      } catch (err) {
        console.error('[Stripe]', err.message);
      }
    }
  }

  res.json({ success: true, redirect: '/dashboard?welcome=1' });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  users = loadUsers();
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'No account found with that email.' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password.' });

  const token = signToken(user);
  res.cookie('rp_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.json({ success: true, redirect: req.body.next || '/dashboard' });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('rp_token');
  res.json({ success: true, redirect: '/' });
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { passwordHash, ...safe } = user;
  res.json(safe);
});

// ════════════════════════════════════════════════════════════════════════════
// STRIPE ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/stripe/create-checkout
app.post('/api/stripe/create-checkout', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
  const { plan } = req.body;
  const priceIds = {
    starter: process.env.STRIPE_STARTER_PRICE_ID,
    growth:  process.env.STRIPE_GROWTH_PRICE_ID,
    pro:     process.env.STRIPE_PRO_PRICE_ID,
  };
  const priceId = priceIds[plan];
  if (!priceId) return res.status(400).json({ error: 'Invalid plan.' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: req.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard?upgraded=1`,
      cancel_url:  `${process.env.APP_URL || 'http://localhost:3000'}/pricing`,
      metadata: { userId: req.user.id },
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stripe/webhook
app.post('/api/stripe/webhook', (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(200);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook]', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  users = loadUsers();
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const user = users.find(u => u.id === session.metadata?.userId);
    if (user) {
      user.stripeCustomerId = session.customer;
      user.stripeSubscriptionId = session.subscription;
      user.subscriptionStatus = 'active';
      saveUsers(users);
    }
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const user = users.find(u => u.stripeCustomerId === sub.customer);
    if (user) {
      user.subscriptionStatus = sub.status;
      saveUsers(users);
    }
  }
  res.sendStatus(200);
});

// GET /api/stripe/portal
app.get('/api/stripe/portal', requireAuth, async (req, res) => {
  if (!stripe || !req.user.stripeCustomerId) return res.redirect('/pricing');
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripeCustomerId,
      return_url: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard`,
    });
    res.redirect(session.url);
  } catch (err) {
    res.redirect('/dashboard');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// EXISTING API ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/send-request
app.post('/api/send-request', requireAuth, async (req, res) => {
  const { customerName, phone, service, city, reviewLink } = req.body;
  if (!customerName || !phone || !service) return res.status(400).json({ error: 'customerName, phone, and service are required.' });

  const link = (reviewLink || '').trim() || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const smsBody = `Hi ${customerName}, thanks for choosing us for your ${service}! Could you leave us a quick Google review? It only takes 30 seconds: ${link}`;

  const entry = { id: Date.now(), type: 'sms_sent', timestamp: new Date().toISOString(), customerName: customerName.trim(), phone: phone.trim(), service: service.trim(), city: (city || '').trim(), message: smsBody, status: 'pending', twilioSid: null, error: null };

  try {
    const result    = await sendTwilioSMS(phone.trim(), smsBody);
    entry.status    = 'delivered';
    entry.twilioSid = result.sid;
    activityFeed.unshift(entry);
    return res.json({ success: true, entry });
  } catch (err) {
    entry.status = 'failed';
    entry.error  = err.message;
    activityFeed.unshift(entry);
    console.error('[Twilio]', err.message);
    return res.status(502).json({ error: err.message, entry });
  }
});

// POST /api/webhook/review
app.post('/api/webhook/review', async (req, res) => {
  const { reviewText, reviewerName, service, city, rating } = req.body;
  if (!reviewText || !reviewText.trim()) return res.status(400).json({ error: 'reviewText is required.' });
  const numericRating = Math.min(5, Math.max(1, Number(rating) || 5));
  try {
    const aiReply = await generateAIReply(reviewText.trim(), (service || '').trim(), (city || '').trim(), numericRating);
    const entry = { id: Date.now(), type: 'review_received', timestamp: new Date().toISOString(), reviewerName: (reviewerName || 'Anonymous').trim(), service: (service || 'General Service').trim(), city: (city || '').trim(), rating: numericRating, reviewText: reviewText.trim(), aiReply };
    activityFeed.unshift(entry);
    return res.json({ success: true, entry });
  } catch (err) {
    console.error('[AI Reply]', err.message);
    return res.status(502).json({ error: err.message });
  }
});

// GET /api/feed
app.get('/api/feed', requireAuth, (_req, res) => { res.json(activityFeed); });

// GET /api/leads (admin)
app.get('/api/leads', (_req, res) => {
  users = loadUsers();
  const safe = users.map(({ passwordHash, ...u }) => u);
  res.json({ count: safe.length, leads: safe });
});

// POST /api/optimize
app.post('/api/optimize', async (req, res) => {
  const { businessName, category, city, services, currentDescription, website } = req.body;
  if (!businessName || !category || !city || !services) return res.status(400).json({ error: 'businessName, category, city, and services are required.' });
  try {
    const analysis = await generateGBPOptimization({ businessName, category, city, services, currentDescription, website });
    console.log(`[GBP Optimize] ${businessName} in ${city} — score ${analysis.score?.overall}`);
    return res.json({ success: true, analysis });
  } catch (err) {
    console.error('[GBP Optimize]', err.message);
    return res.status(502).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PAGE ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/',                    (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login',               (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup',              (_req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/pricing',             (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/ranking-calculator',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'ranking-calculator.html')));
app.get('/dashboard',           requireAuth, requireSubscription, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/optimize',            requireAuth, requireSubscription, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'optimize.html')));
app.get('/health',              (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ReviewPilot running → http://localhost:${PORT}\n`);
  if (!process.env.TWILIO_ACCOUNT_SID) console.log('  ⚠  Twilio credentials not set — SMS will fail gracefully.');
  if (!process.env.ANTHROPIC_API_KEY)  console.log('  ⚠  Anthropic API key not set — AI features will fail gracefully.');
  if (!process.env.STRIPE_SECRET_KEY)  console.log('  ⚠  Stripe not configured — payments disabled (trial access only).');
  console.log();
});
