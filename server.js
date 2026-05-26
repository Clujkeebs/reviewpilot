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
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function loadCustomers() {
  try { return JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8')); }
  catch { return []; }
}
function saveCustomers(c) {
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(c, null, 2));
}

let users        = loadUsers();
let customers    = loadCustomers();
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
  const { passwordHash, resetToken, resetExpires, ...safe } = user;
  res.json(safe);
});

// PATCH /api/auth/me — update profile
app.patch('/api/auth/me', requireAuth, (req, res) => {
  users = loadUsers();
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { name, businessName, trade, phone } = req.body;
  if (typeof name === 'string')         user.name = name.trim();
  if (typeof businessName === 'string') user.businessName = businessName.trim();
  if (typeof trade === 'string')        user.trade = trade.trim();
  if (typeof phone === 'string')        user.phone = phone.trim();
  saveUsers(users);
  const { passwordHash, resetToken, resetExpires, ...safe } = user;
  res.json({ success: true, user: safe });
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });
  if (newPassword.length < 8)            return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  users = loadUsers();
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  saveUsers(users);
  res.json({ success: true });
});

// POST /api/auth/delete-account
app.post('/api/auth/delete-account', requireAuth, (req, res) => {
  users = loadUsers();
  customers = loadCustomers();
  users = users.filter(u => u.id !== req.user.id);
  customers = customers.filter(c => c.userId !== req.user.id);
  saveUsers(users);
  saveCustomers(customers);
  res.clearCookie('rp_token');
  res.json({ success: true, redirect: '/' });
});

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  users = loadUsers();
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (user) {
    const token = require('crypto').randomBytes(32).toString('hex');
    user.resetToken   = token;
    user.resetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    saveUsers(users);
    const url = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    console.log(`[Password Reset] ${user.email} → ${url}`);
  }
  // Always respond success so we don't leak whether the email exists
  res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
  if (newPassword.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  users = loadUsers();
  const user = users.find(u => u.resetToken === token && Number(u.resetExpires) > Date.now());
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  delete user.resetToken;
  delete user.resetExpires;
  saveUsers(users);
  res.json({ success: true, redirect: '/login' });
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

  let twilioOk = false;
  try {
    const result    = await sendTwilioSMS(phone.trim(), smsBody);
    entry.status    = 'delivered';
    entry.twilioSid = result.sid;
    twilioOk = true;
  } catch (err) {
    entry.status = 'failed';
    entry.error  = err.message;
    console.error('[Twilio]', err.message);
  }
  activityFeed.unshift(entry);

  // Persist as a customer record for this user (even if Twilio failed, so user can retry follow-up)
  try {
    customers = loadCustomers();
    const customer = {
      id: 'c_' + Date.now(),
      userId: req.user.id,
      name: customerName.trim(),
      phone: phone.trim(),
      service: service.trim(),
      city: (city || '').trim(),
      addedAt: new Date().toISOString(),
      status: twilioOk ? 'sent' : 'pending',
      lastSmsAt: twilioOk ? new Date().toISOString() : null,
      followUpAt: null,
      smsCount: twilioOk ? 1 : 0,
    };
    customers.push(customer);
    saveCustomers(customers);
  } catch (err) {
    console.error('[Customers] failed to persist customer:', err.message);
  }

  if (twilioOk) return res.json({ success: true, entry });
  return res.status(502).json({ error: entry.error, entry });
});

// ════════════════════════════════════════════════════════════════════════════
// CUSTOMERS API
// ════════════════════════════════════════════════════════════════════════════

// POST /api/customers — add a new customer (auto-sends initial SMS)
app.post('/api/customers', requireAuth, async (req, res) => {
  const { name, phone, service, city } = req.body;
  if (!name || !phone || !service) return res.status(400).json({ error: 'name, phone, and service are required.' });
  customers = loadCustomers();

  const customer = {
    id: 'c_' + Date.now(),
    userId: req.user.id,
    name: name.trim(),
    phone: phone.trim(),
    service: service.trim(),
    city: (city || '').trim(),
    addedAt: new Date().toISOString(),
    status: 'pending',
    lastSmsAt: null,
    followUpAt: null,
    smsCount: 0,
  };

  // Attempt initial SMS — gracefully no-op if Twilio isn't configured
  const link    = process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const smsBody = `Hi ${customer.name}, thanks for choosing us for your ${customer.service}! Could you leave us a quick Google review? It only takes 30 seconds: ${link}`;
  try {
    await sendTwilioSMS(customer.phone, smsBody);
    customer.status    = 'sent';
    customer.lastSmsAt = new Date().toISOString();
    customer.smsCount  = 1;
  } catch (err) {
    console.warn('[Customers] initial SMS skipped:', err.message);
  }

  customers.push(customer);
  saveCustomers(customers);
  res.json({ success: true, customer });
});

// GET /api/customers — list current user's customers
app.get('/api/customers', requireAuth, (req, res) => {
  customers = loadCustomers();
  const mine = customers.filter(c => c.userId === req.user.id).sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  res.json(mine);
});

// POST /api/customers/:id/send-followup
app.post('/api/customers/:id/send-followup', requireAuth, async (req, res) => {
  customers = loadCustomers();
  const customer = customers.find(c => c.id === req.params.id && c.userId === req.user.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const link    = process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const body    = `Hi ${customer.name}, just a friendly reminder — we'd love a quick Google review for the ${customer.service} we did. Takes 30 seconds: ${link}. Thanks!`;
  try {
    await sendTwilioSMS(customer.phone, body);
    customer.lastSmsAt = new Date().toISOString();
    customer.smsCount  = (customer.smsCount || 0) + 1;
    customer.status    = 'followup_sent';
    saveCustomers(customers);
    res.json({ success: true, customer });
  } catch (err) {
    console.error('[Customer Followup]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// DELETE /api/customers/:id
app.delete('/api/customers/:id', requireAuth, (req, res) => {
  customers = loadCustomers();
  const before = customers.length;
  customers = customers.filter(c => !(c.id === req.params.id && c.userId === req.user.id));
  if (customers.length === before) return res.status(404).json({ error: 'Customer not found.' });
  saveCustomers(customers);
  res.json({ success: true });
});

// POST /api/customers/:id/mark-reviewed
app.post('/api/customers/:id/mark-reviewed', requireAuth, (req, res) => {
  customers = loadCustomers();
  const customer = customers.find(c => c.id === req.params.id && c.userId === req.user.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  customer.status = 'reviewed';
  saveCustomers(customers);
  res.json({ success: true, customer });
});

// GET /api/stats — real dashboard stats for current user
app.get('/api/stats', requireAuth, (req, res) => {
  customers = loadCustomers();
  const mine = customers.filter(c => c.userId === req.user.id);
  const smsSent = mine.filter(c => c.status === 'sent' || c.status === 'followup_sent' || c.status === 'reviewed' || c.status === 'completed').length;
  const reviews = mine.filter(c => c.status === 'reviewed' || c.status === 'completed').length;
  const reviewEntries = activityFeed.filter(i => i.type === 'review_received');
  const avgRating = reviewEntries.length
    ? (reviewEntries.reduce((s, i) => s + (Number(i.rating) || 0), 0) / reviewEntries.length).toFixed(1)
    : null;
  const replies = reviewEntries.length;
  res.json({ smsSent, reviews, avgRating, replies });
});

// POST /api/webhook/review
app.post('/api/webhook/review', requireAuth, async (req, res) => {
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

// GET /api/leads (admin — requires ADMIN_KEY header)
app.get('/api/leads', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  users = loadUsers();
  const safe = users.map(({ passwordHash, ...u }) => u);
  res.json({ count: safe.length, leads: safe });
});

// GET /api/audit-leads (admin — requires ADMIN_KEY header)
app.get('/api/audit-leads', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const leadsPath = path.join(__dirname, 'data', 'audit-leads.json');
    const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
    res.json({ count: leads.length, leads });
  } catch { res.json({ count: 0, leads: [] }); }
});

// POST /api/optimize
app.post('/api/optimize', async (req, res) => {
  const { businessName, category, city, services, currentDescription, website, email } = req.body;
  if (!businessName || !category || !city || !services) return res.status(400).json({ error: 'businessName, category, city, and services are required.' });

  // Track lead if email provided (from free ranking calculator)
  if (email && email.includes('@')) {
    try {
      const leadsPath = path.join(__dirname, 'data', 'audit-leads.json');
      let leads = [];
      try { leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8')); } catch {}
      leads.push({ email, businessName, category, city, services, website, ts: new Date().toISOString() });
      fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2));
      console.log(`[Lead] Captured: ${email} — ${businessName} in ${city}`);
    } catch (e) { console.error('[Lead] save failed:', e.message); }
  }

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
app.get('/account',             requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'account.html')));
app.get('/reset-password',      (_req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-password.html')));
app.get('/health',              (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Page Not Found — ReviewPilot</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"/><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',system-ui,sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.wrap{text-align:center;max-width:440px}.ico{font-size:64px;margin-bottom:16px}h1{font-size:28px;font-weight:800;color:#0f2340;margin-bottom:8px}p{font-size:15px;color:#6b7280;line-height:1.6;margin-bottom:24px}a{display:inline-block;padding:12px 28px;background:#0f2340;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;transition:background .15s}a:hover{background:#163352}</style></head><body><div class="wrap"><div class="ico">📍</div><h1>Page not found</h1><p>The page you're looking for doesn't exist or has been moved. Let's get you back on track.</p><a href="/">← Back to ReviewPilot</a></div></body></html>`);
});

// ── Automated follow-up scheduler ─────────────────────────────────────────────
// Every 5 minutes: send a single follow-up SMS to customers who got the initial
// SMS at least 3 days ago and haven't reviewed yet (max 2 total SMS per customer).
setInterval(async () => {
  customers = loadCustomers();
  const now = Date.now();
  for (const c of customers) {
    if (c.status === 'sent' && c.smsCount < 2 && c.lastSmsAt) {
      const daysSince = (now - new Date(c.lastSmsAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince >= 3) {
        try {
          const user = users.find(u => u.id === c.userId);
          if (!user) continue;
          const reviewLink = process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-link';
          const body = `Hi ${c.name}, just a friendly reminder — we'd love a quick Google review for the ${c.service} we did. Takes 30 seconds: ${reviewLink}. Thanks!`;
          await sendTwilioSMS(c.phone, body);
          c.lastSmsAt = new Date().toISOString();
          c.smsCount  = (c.smsCount || 1) + 1;
          c.status    = 'followup_sent';
          saveCustomers(customers);
          console.log(`[Auto-Followup] sent to ${c.name} (${c.phone})`);
        } catch (err) { console.error('[Auto-Followup]', err.message); }
      }
    }
  }
}, 5 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ReviewPilot running → http://localhost:${PORT}\n`);
  if (!process.env.TWILIO_ACCOUNT_SID) console.log('  ⚠  Twilio credentials not set — SMS will fail gracefully.');
  if (!process.env.ANTHROPIC_API_KEY)  console.log('  ⚠  Anthropic API key not set — AI features will fail gracefully.');
  if (!process.env.STRIPE_SECRET_KEY)  console.log('  ⚠  Stripe not configured — payments disabled (trial access only).');
  console.log();
});
