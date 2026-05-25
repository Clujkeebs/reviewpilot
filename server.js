require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// In-memory stores – replace with DB for production
const activityFeed = [];
const leads        = [];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Twilio SMS ───────────────────────────────────────────────────────────────
async function sendTwilioSMS(toNumber, messageBody) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID, ' +
      'TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in your .env file.'
    );
  }

  const url         = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: toNumber, From: fromNumber, Body: messageBody }).toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Twilio API error (HTTP ${response.status})`);
  }

  return data;
}

// ── Anthropic AI reply ───────────────────────────────────────────────────────
async function generateAIReply(reviewText, service, city, rating) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'Anthropic API key not configured. Add ANTHROPIC_API_KEY to your .env file.'
    );
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 220,
    system:
      'You are a professional operations manager for a local business. ' +
      'Write a friendly, 2-sentence reply to this customer review. ' +
      'Naturally include the city name and the service provided to boost local SEO. ' +
      'Do not sound like a robot. Do not use generic phrases like "We appreciate your feedback."',
    messages: [
      {
        role:    'user',
        content:
          `Write a reply to this ${rating}-star Google review for our ` +
          `${service || 'service'} in ${city || 'local area'}:\n\n"${reviewText}"`,
      },
    ],
  });

  return message.content[0].text;
}

// ── POST /api/send-request ───────────────────────────────────────────────────
app.post('/api/send-request', async (req, res) => {
  const { customerName, phone, service, city, reviewLink } = req.body;

  if (!customerName || !phone || !service) {
    return res.status(400).json({ error: 'customerName, phone, and service are required.' });
  }

  const link = (reviewLink || '').trim() || process.env.DEFAULT_REVIEW_LINK || 'https://g.page/r/your-review-link';
  const smsBody =
    `Hi ${customerName}, thanks for choosing us for your ${service}! ` +
    `Could you leave us a quick Google review? It only takes 30 seconds: ${link}`;

  const entry = {
    id:           Date.now(),
    type:         'sms_sent',
    timestamp:    new Date().toISOString(),
    customerName: customerName.trim(),
    phone:        phone.trim(),
    service:      service.trim(),
    city:         (city || '').trim(),
    message:      smsBody,
    status:       'pending',
    twilioSid:    null,
    error:        null,
  };

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

// ── POST /api/webhook/review ─────────────────────────────────────────────────
// In production, Google My Business would POST here.
// From the dashboard, you can simulate this directly.
app.post('/api/webhook/review', async (req, res) => {
  const { reviewText, reviewerName, service, city, rating } = req.body;

  if (!reviewText || !reviewText.trim()) {
    return res.status(400).json({ error: 'reviewText is required.' });
  }

  const numericRating = Math.min(5, Math.max(1, Number(rating) || 5));

  try {
    const aiReply = await generateAIReply(
      reviewText.trim(),
      (service || '').trim(),
      (city || '').trim(),
      numericRating
    );

    const entry = {
      id:           Date.now(),
      type:         'review_received',
      timestamp:    new Date().toISOString(),
      reviewerName: (reviewerName || 'Anonymous').trim(),
      service:      (service || 'General Service').trim(),
      city:         (city || '').trim(),
      rating:       numericRating,
      reviewText:   reviewText.trim(),
      aiReply,
    };

    activityFeed.unshift(entry);
    return res.json({ success: true, entry });
  } catch (err) {
    console.error('[AI Reply]', err.message);
    return res.status(502).json({ error: err.message });
  }
});

// ── GET /api/feed ────────────────────────────────────────────────────────────
app.get('/api/feed', (_req, res) => {
  res.json(activityFeed);
});

// ── GET /health ── used by Render / Railway uptime checks ────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── GET /dashboard ───────────────────────────────────────────────────────────
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ── GET /signup ───────────────────────────────────────────────────────────────
app.get('/signup', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// ── POST /api/signup ──────────────────────────────────────────────────────────
app.post('/api/signup', (req, res) => {
  const { name, email, businessName, trade, phone, plan } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const existing = leads.find(l => l.email.toLowerCase() === email.toLowerCase().trim());
  if (existing) {
    // Already signed up — send them straight to the dashboard
    return res.json({ success: true, redirect: '/dashboard?welcome=returning' });
  }

  const lead = {
    id:           Date.now(),
    name:         name.trim(),
    email:        email.toLowerCase().trim(),
    businessName: (businessName || '').trim(),
    trade:        (trade || '').trim(),
    phone:        (phone || '').trim(),
    plan:         plan || 'starter',
    signedUpAt:   new Date().toISOString(),
  };

  leads.push(lead);
  console.log(`[New Lead] ${lead.name} | ${lead.email} | ${lead.businessName} | ${lead.trade} | ${lead.plan}`);

  res.json({ success: true, redirect: '/dashboard?welcome=1' });
});

// ── GET /api/leads ── simple admin view (add auth before making this public) ─
app.get('/api/leads', (_req, res) => {
  res.json({ count: leads.length, leads });
});

// ── GET /optimize ────────────────────────────────────────────────────────────
app.get('/optimize', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'optimize.html'));
});

// ── GBP Optimizer: Claude analysis ───────────────────────────────────────────
async function generateGBPOptimization({ businessName, category, city, services, currentDescription, website }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic API key not configured. Add ANTHROPIC_API_KEY to your .env file.');
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMsg = [
    `Business Name: ${businessName}`,
    `Trade / GBP Category: ${category}`,
    `City: ${city}`,
    `Services Offered: ${services || 'Not specified'}`,
    `Current GBP Description: ${currentDescription || 'None provided'}`,
    `Website: ${website || 'Not provided'}`,
  ].join('\n');

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `You are a Google Business Profile (GBP) optimization expert and local SEO specialist with 10+ years of experience helping local service businesses rank #1 on Google Maps.

Analyze the business and return a comprehensive, specific, actionable optimization report.

RULES:
- Be specific — use the actual city, trade name, and service names in every recommendation
- Use real, exact GBP category names as Google lists them
- Every Q&A answer must mention the city and service naturally for local SEO
- Google Posts must be 80-100 words, conversational, keyword-rich
- Score based on what they told you: no description = low description score, etc.
- Return ONLY valid JSON — no markdown, no code fences, no text outside the JSON

Required JSON structure (follow exactly):
{
  "score": {
    "overall": <integer 0-100>,
    "description": <integer 0-100>,
    "categories": <integer 0-100>,
    "photos": <integer 0-100>,
    "posts": <integer 0-100>,
    "qanda": <integer 0-100>,
    "verdict": "<2 honest sentences: current state + single biggest opportunity, mention city and trade>"
  },
  "optimizedDescription": "<250-300 character GBP description, keyword-rich, mentions city and trade naturally, copy-paste ready>",
  "descriptionKeywords": ["<kw>","<kw>","<kw>","<kw>","<kw>"],
  "categories": {
    "primary": "<exact GBP category name>",
    "additional": ["<exact GBP category>","<exact GBP category>","<exact GBP category>","<exact GBP category>"]
  },
  "photoChecklist": [
    {"photo":"<specific photo description>","priority":"Critical","why":"<1 sentence on ranking/trust impact>"},
    {"photo":"<photo>","priority":"High","why":"<why>"},
    {"photo":"<photo>","priority":"High","why":"<why>"},
    {"photo":"<photo>","priority":"Medium","why":"<why>"},
    {"photo":"<photo>","priority":"Medium","why":"<why>"},
    {"photo":"<photo>","priority":"Medium","why":"<why>"}
  ],
  "qaTemplates": [
    {"question":"<question a real local customer searches, includes city/service>","answer":"<2-3 sentence keyword-rich answer mentioning city and service>"},
    {"question":"<question>","answer":"<answer>"},
    {"question":"<question>","answer":"<answer>"},
    {"question":"<question>","answer":"<answer>"},
    {"question":"<question>","answer":"<answer>"}
  ],
  "contentCalendar": [
    {"week":"Week 1","postType":"Offer","title":"<title>","body":"<80-100 word post body with local keywords>","cta":"<call to action text>"},
    {"week":"Week 2","postType":"Update","title":"<title>","body":"<body>","cta":"<cta>"},
    {"week":"Week 3","postType":"Tip","title":"<title>","body":"<body>","cta":"<cta>"},
    {"week":"Week 4","postType":"Highlight","title":"<title>","body":"<body>","cta":"<cta>"}
  ],
  "keywords": {
    "primary": ["<keyword>","<keyword>","<keyword>"],
    "longTail": ["<keyword>","<keyword>","<keyword>","<keyword>"],
    "avoidTerms": ["<term>","<term>","<term>"],
    "replyTip": "<specific 1-2 sentence tip on weaving these keywords into review replies naturally>"
  },
  "completenessItems": [
    {"item":"<specific GBP field or setting name>","priority":"Critical","howTo":"<brief actionable instruction>"},
    {"item":"<item>","priority":"High","howTo":"<howto>"},
    {"item":"<item>","priority":"High","howTo":"<howto>"},
    {"item":"<item>","priority":"High","howTo":"<howto>"},
    {"item":"<item>","priority":"Medium","howTo":"<howto>"},
    {"item":"<item>","priority":"Medium","howTo":"<howto>"},
    {"item":"<item>","priority":"Medium","howTo":"<howto>"}
  ],
  "quickWins": [
    {"action":"<specific immediate action>","impact":"High","time":"5 min","why":"<1 sentence ranking impact>"},
    {"action":"<action>","impact":"High","time":"<time>","why":"<why>"},
    {"action":"<action>","impact":"High","time":"<time>","why":"<why>"},
    {"action":"<action>","impact":"Medium","time":"<time>","why":"<why>"},
    {"action":"<action>","impact":"Medium","time":"<time>","why":"<why>"}
  ]
}`,
    messages: [{ role: 'user', content: userMsg }],
  });

  const raw   = message.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI returned an unexpected format. Please try again.');

  return JSON.parse(match[0]);
}

// ── POST /api/optimize ────────────────────────────────────────────────────────
app.post('/api/optimize', async (req, res) => {
  const { businessName, category, city, services, currentDescription, website } = req.body;

  if (!businessName || !category || !city || !services) {
    return res.status(400).json({ error: 'businessName, category, city, and services are required.' });
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

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ReviewPilot running → http://localhost:${PORT}\n`);
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.log('  ⚠  Twilio credentials not set — SMS sends will fail gracefully.');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  ⚠  Anthropic API key not set — AI replies will fail gracefully.');
  }
  console.log();
});
