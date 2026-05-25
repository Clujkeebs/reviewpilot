/* ── Config ──────────────────────────────────────────────────────────────── */
const API = '';   // same origin – Express serves both

/* ── State ───────────────────────────────────────────────────────────────── */
let knownIds      = new Set();
let selectedRating = 5;
const copyMap     = new Map();   // itemId → aiReply text (avoids HTML-encoding issues)

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const smsForm    = document.getElementById('sms-form');
const smsBtnTxt  = document.getElementById('sms-btn-txt');
const smsSpinner = document.getElementById('sms-spinner');
const smsBtn     = document.getElementById('sms-btn');

const simBtn     = document.getElementById('sim-btn');
const simBtnTxt  = document.getElementById('sim-btn-txt');
const simSpinner = document.getElementById('sim-spinner');

const feedBody   = document.getElementById('feed-body');
const emptyState = document.getElementById('empty-state');
const feedCount  = document.getElementById('feed-count');
const clearBtn   = document.getElementById('clear-btn');

const statSMS     = document.getElementById('stat-sms');
const statReviews = document.getElementById('stat-reviews');
const statRating  = document.getElementById('stat-rating');
const statReplies = document.getElementById('stat-replies');

/* ── Star rating ─────────────────────────────────────────────────────────── */
document.querySelectorAll('.star').forEach(star => {
  star.addEventListener('mouseenter', () => paintStars(Number(star.dataset.v)));
  star.addEventListener('mouseleave', () => paintStars(selectedRating));
  star.addEventListener('click', () => {
    selectedRating = Number(star.dataset.v);
    document.getElementById('ratingVal').value = selectedRating;
    paintStars(selectedRating);
  });
});

function paintStars(n) {
  document.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('active', i < n));
}

/* ── Auto-mirror service/city into simulate fields ───────────────────────── */
document.getElementById('service').addEventListener('input', e => {
  const el = document.getElementById('simService');
  if (!el.dataset.touched) el.value = e.target.value;
});
document.getElementById('city').addEventListener('input', e => {
  const el = document.getElementById('simCity');
  if (!el.dataset.touched) el.value = e.target.value;
});
['simService', 'simCity'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => { e.target.dataset.touched = '1'; });
});

/* ── SMS form submit ─────────────────────────────────────────────────────── */
smsForm.addEventListener('submit', async e => {
  e.preventDefault();

  const customerName = smsForm.customerName.value.trim();
  const phone        = smsForm.phone.value.trim();
  const service      = smsForm.service.value.trim();

  // Basic validation
  if (!customerName || !phone || !service) {
    if (!customerName) shake(smsForm.customerName);
    if (!phone)        shake(smsForm.phone);
    if (!service)      shake(smsForm.service);
    return;
  }

  setBusy(smsBtn, smsSpinner, smsBtnTxt, true, 'Sending…');

  const payload = {
    customerName,
    phone,
    service,
    city:        smsForm.city.value.trim(),
    reviewLink:  smsForm.reviewLink.value.trim(),
  };

  try {
    const res  = await fetch(`${API}/api/send-request`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.entry) insertItem(data.entry);

    if (res.ok) {
      toast('ok', `✅ SMS sent to ${customerName}`);
      smsForm.reset();
    } else {
      toast('err', `⚠️ ${data.error}`);
    }
  } catch (err) {
    toast('err', `Network error: ${err.message}`);
  } finally {
    setBusy(smsBtn, smsSpinner, smsBtnTxt, false, 'Send Review Request via SMS');
    syncFeed();
  }
});

/* ── Simulate review ─────────────────────────────────────────────────────── */
simBtn.addEventListener('click', async () => {
  const reviewText = document.getElementById('reviewText').value.trim();
  if (!reviewText) { shake(document.getElementById('reviewText')); return; }

  setBusy(simBtn, simSpinner, simBtnTxt, true, 'Generating reply…');

  const payload = {
    reviewText,
    reviewerName: document.getElementById('reviewerName').value.trim(),
    service:      document.getElementById('simService').value.trim(),
    city:         document.getElementById('simCity').value.trim(),
    rating:       selectedRating,
  };

  try {
    const res  = await fetch(`${API}/api/webhook/review`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok && data.entry) {
      insertItem(data.entry);
      toast('ok', '🤖 AI reply generated!');
    } else {
      toast('err', `AI error: ${data.error}`);
    }
  } catch (err) {
    toast('err', `Network error: ${err.message}`);
  } finally {
    setBusy(simBtn, simSpinner, simBtnTxt, false, 'Generate AI Reply');
  }
});

/* ── Clear feed ──────────────────────────────────────────────────────────── */
clearBtn.addEventListener('click', () => {
  feedBody.querySelectorAll('.fi').forEach(el => el.remove());
  knownIds.clear();
  copyMap.clear();
  checkEmpty();
  updateStats([]);
  toast('info', 'Feed cleared.');
});

/* ── Feed polling (4-second interval) ───────────────────────────────────── */
async function syncFeed() {
  try {
    const res  = await fetch(`${API}/api/feed`);
    const feed = await res.json();
    updateStats(feed);
    // Insert any items the server has that we don't (e.g. from other sessions)
    feed.forEach(item => {
      if (!knownIds.has(item.id)) insertItem(item, false);
    });
  } catch (_) { /* network hiccup – ignore */ }
}

setInterval(syncFeed, 4000);
syncFeed();   // immediate first load

/* ── Render: insert a feed item ──────────────────────────────────────────── */
function insertItem(item, animate = true) {
  if (knownIds.has(item.id)) return;
  knownIds.add(item.id);

  if (item.type === 'review_received' && item.aiReply) {
    copyMap.set(item.id, item.aiReply);
  }

  const el    = document.createElement('div');
  el.className = 'fi';
  if (!animate) el.style.animation = 'none';
  el.id       = `fi-${item.id}`;
  el.innerHTML = item.type === 'sms_sent' ? renderSMS(item) : renderReview(item);

  // Remove empty state if present
  if (emptyState.parentNode === feedBody) emptyState.remove();

  feedBody.prepend(el);
  checkEmpty();

  // Wire copy button
  const copyBtn = el.querySelector('[data-cid]');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = copyMap.get(Number(copyBtn.dataset.cid));
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = '⎘'; copyBtn.classList.remove('copied'); }, 2200);
      });
    });
  }
}

/* ── SMS item template ───────────────────────────────────────────────────── */
function renderSMS(item) {
  const ok       = item.status === 'delivered';
  const badgeCls = ok ? 'badge-ok' : 'badge-err';
  const badgeTxt = ok ? '✓ Sent' : '✗ Failed';
  const sub      = [item.phone, item.service, item.city].filter(Boolean).join(' · ');

  return `
    <div class="fi-row">
      <div class="fi-ico">📱</div>
      <div class="fi-meta">
        <div class="fi-top">
          <span class="fi-name">${esc(item.customerName)}</span>
          <span class="fi-time">${relTime(item.timestamp)}</span>
        </div>
        <div class="fi-sub">${esc(sub)}</div>
      </div>
      <span class="badge ${badgeCls}">${badgeTxt}</span>
    </div>
    <div class="fi-msg">${esc(item.message)}</div>
    ${item.error ? `<div class="fi-err">⚠ ${esc(item.error)}</div>` : ''}
  `;
}

/* ── Review item template ────────────────────────────────────────────────── */
function renderReview(item) {
  const filledStars = '★'.repeat(item.rating);
  const emptyStars  = '☆'.repeat(5 - item.rating);
  const sub         = [item.service, item.city].filter(Boolean).join(' · ');

  return `
    <div class="fi-row">
      <div class="fi-ico">⭐</div>
      <div class="fi-meta">
        <div class="fi-top">
          <span class="fi-name">${esc(item.reviewerName)}</span>
          <span class="fi-time">${relTime(item.timestamp)}</span>
        </div>
        <div class="fi-sub">${esc(sub)}</div>
      </div>
      <span class="badge badge-review">New Review</span>
    </div>
    <div class="fi-stars" title="${item.rating} out of 5 stars">${filledStars}<span style="opacity:.35">${emptyStars}</span></div>
    <div class="fi-quote">${esc(item.reviewText)}</div>
    <div class="fi-ai">
      <div class="fi-ai-lbl">
        <span class="fi-ai-lbl-left">
          <span>🤖</span>
          <span>AI-Generated Reply · Ready to post</span>
        </span>
        <button class="copy-btn" data-cid="${item.id}" title="Copy reply to clipboard">⎘</button>
      </div>
      <div class="fi-ai-text">${esc(item.aiReply)}</div>
    </div>
  `;
}

/* ── Stats ───────────────────────────────────────────────────────────────── */
function updateStats(feed) {
  const smsSent  = feed.filter(i => i.type === 'sms_sent' && i.status === 'delivered').length;
  const reviews  = feed.filter(i => i.type === 'review_received');
  const avg      = reviews.length
    ? (reviews.reduce((s, i) => s + i.rating, 0) / reviews.length).toFixed(1)
    : '–';

  statSMS.textContent     = smsSent;
  statReviews.textContent = reviews.length;
  statRating.textContent  = avg;
  statReplies.textContent = reviews.length;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function checkEmpty() {
  const items = feedBody.querySelectorAll('.fi');
  feedCount.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
  if (items.length === 0) feedBody.appendChild(emptyState);
}

function setBusy(btn, spinner, label, busy, txt) {
  btn.disabled = busy;
  spinner.classList.toggle('hidden', !busy);
  label.textContent = txt;
}

function relTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 10)   return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// XSS-safe escape for innerHTML
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shake(el) {
  el.classList.add('error');
  el.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(-5px)' },
    { transform: 'translateX(5px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(0)' },
  ], { duration: 300, easing: 'ease' });
  el.addEventListener('input', () => el.classList.remove('error'), { once: true });
}

function toast(type, msg) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, 3600);
}

// ── Welcome toast on redirect from signup ─────────────────────────────────────
(function handleWelcome() {
  const p = new URLSearchParams(window.location.search);
  const w = p.get('welcome');
  if (w === '1') {
    setTimeout(() => toast('ok', '🎉 Welcome to ReviewPilot! Send your first review request to get started.'), 500);
    window.history.replaceState({}, '', '/dashboard');
  } else if (w === 'returning') {
    setTimeout(() => toast('info', '👋 Welcome back! Your dashboard is ready.'), 500);
    window.history.replaceState({}, '', '/dashboard');
  }
})();
