/* ═══════════════════════════════════════════════════════════════════════════
   ranking-calculator.js — AI-powered GBP audit (calls /api/optimize)
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Color / grade helpers ─────────────────────────────────────────────── */
function scoreColor(s) {
  if (s < 40) return '#dc2626';
  if (s < 60) return '#ea580c';
  if (s < 75) return '#ca8a04';
  return '#059669';
}
function gradeClass(s) {
  if (s < 40) return 'red';
  if (s < 60) return 'orange';
  if (s < 75) return 'yellow';
  return 'green';
}
function gradeLabel(s) {
  if (s < 40) return 'Critical';
  if (s < 60) return 'Needs Work';
  if (s < 75) return 'Getting There';
  return 'Strong';
}
function verdict(s) {
  if (s < 40) return "Your Google Business Profile has serious gaps — you're nearly invisible to searchers. Competitors are getting calls that should be yours.";
  if (s < 60) return "Your profile is showing up but losing leads to better-optimized competitors. A few key fixes will make a big difference.";
  if (s < 75) return "You're competitive, but clear gaps are holding you back from the top spot in your city.";
  return "Strong profile! A few strategic tweaks could lock in the #1 position.";
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

/* ── Animate score ring ────────────────────────────────────────────────── */
function animateRing(score) {
  const circ = 163;
  const ring = document.getElementById('score-ring-fg');
  const num  = document.getElementById('score-ring-num');
  ring.style.stroke = scoreColor(score);
  let cur = 0;
  const start = performance.now();
  (function step(now) {
    const p = Math.min((now - start) / 1400, 1);
    const e = 1 - Math.pow(1 - p, 3);
    cur = Math.round(e * score);
    ring.style.strokeDashoffset = circ - (circ * e * score) / 100;
    num.textContent = cur;
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}

/* ── Render results ────────────────────────────────────────────────────── */
function renderResults(analysis, bizName, city, trade) {
  const s = analysis.score;
  const total = s.overall;

  // Score ring
  document.getElementById('res-grade').className = 'score-grade ' + gradeClass(total);
  document.getElementById('res-grade').textContent = gradeLabel(total);
  document.getElementById('res-verdict').textContent = verdict(total);
  document.getElementById('res-meta').textContent = `${esc(bizName)} · ${esc(trade)} in ${esc(city)}`;

  // Breakdown grid
  const cats = [
    { label: 'Description',     pts: s.description, max: 100 },
    { label: 'Categories',      pts: s.categories,  max: 100 },
    { label: 'Photos',          pts: s.photos,      max: 100 },
    { label: 'Posts / Content', pts: s.posts,       max: 100 },
    { label: 'Q&A',             pts: s.qanda,       max: 100 },
  ];
  document.getElementById('breakdown-grid').innerHTML = cats.map(c => {
    const pct = c.pts;
    const color = pct >= 75 ? '#059669' : pct >= 50 ? '#f59e0b' : '#dc2626';
    return `
      <div class="breakdown-item">
        <div class="breakdown-label">${c.label}</div>
        <div class="breakdown-pts">${c.pts}<span>/100</span></div>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar-fill" data-pct="${pct}" style="background:${color}"></div>
        </div>
      </div>`;
  }).join('');

  // Top issues — built from low scores
  const issues = [];
  if (s.description < 50) issues.push({ icon: '✏️', text: `Your GBP description is weak or missing. Google uses it as a primary ranking signal for "${esc(trade)}" searches in ${esc(city)}.` });
  if (s.categories < 50) issues.push({ icon: '🏷️', text: `Your business categories aren't optimized. The wrong primary category means Google shows competitors instead of you.` });
  if (s.photos < 50) issues.push({ icon: '📸', text: `Not enough photos. Profiles with 100+ photos get <strong>520% more calls</strong> than those with fewer than 10.` });
  if (s.posts < 50) issues.push({ icon: '📝', text: `You're not posting on Google regularly. Weekly posts are a free, powerful ranking signal your competitors may be using.` });
  if (s.qanda < 50) issues.push({ icon: '❓', text: `No Q&A section filled out. Pre-populating Q&A with keyword-rich answers is one of the easiest ranking wins.` });
  if (issues.length === 0) issues.push({ icon: '✅', text: `No critical issues found — your profile is in good shape! The locked sections below show how to go from good to dominant.` });

  document.getElementById('res-issues').innerHTML = issues.slice(0, 4).map(i => `
    <div class="issue-item">
      <div class="issue-icon">${i.icon}</div>
      <div class="issue-text">${i.text}</div>
    </div>`).join('');

  // Quick wins — show first 2 free, rest locked
  const qw = analysis.quickWins || [];
  let qwHtml = '';
  qw.forEach((w, i) => {
    const locked = i >= 2;
    qwHtml += `
      <div class="qw-item${locked ? ' qw-locked' : ''}">
        <div class="qw-badge ${w.impact === 'High' ? 'qw-high' : 'qw-med'}">${esc(w.impact)}</div>
        <div class="qw-body">
          <div class="qw-action">${locked ? '<span class="qw-blur">' + esc(w.action) + '</span>' : esc(w.action)}</div>
          <div class="qw-meta">⏱ ${esc(w.time)}${!locked ? ' · ' + esc(w.why) : ''}</div>
        </div>
        ${locked ? '<div class="qw-lock-badge">🔒 Sign up to unlock</div>' : ''}
      </div>`;
  });
  document.getElementById('res-quickwins').innerHTML = qwHtml || '<p style="color:var(--muted)">AI could not generate quick wins for this profile.</p>';

  // Locked previews — show blurred teasers
  // Description
  document.getElementById('preview-description').innerHTML = `
    <div class="locked-blur-text">${esc(analysis.optimizedDescription || 'AI-generated, SEO-optimized description for your business...')}</div>
    <div class="locked-keywords">${(analysis.descriptionKeywords || []).map(k => '<span class="kw-tag">' + esc(k) + '</span>').join('')}</div>`;

  // Categories
  const catData = analysis.categories || {};
  document.getElementById('preview-categories').innerHTML = `
    <div class="locked-blur-text">
      <strong>Primary:</strong> ${esc(catData.primary || 'Optimized primary category')}<br/>
      <strong>Additional:</strong> ${(catData.additional || []).map(esc).join(', ') || 'Up to 4 additional categories'}
    </div>`;

  // Photos
  document.getElementById('preview-photos').innerHTML = `
    <div class="locked-blur-text">${(analysis.photoChecklist || []).map(p =>
      `<div style="margin-bottom:4px">📷 ${esc(p.photo)} — <strong>${esc(p.priority)}</strong></div>`
    ).join('') || 'AI-generated photo checklist...'}</div>`;

  // Q&A
  document.getElementById('preview-qa').innerHTML = `
    <div class="locked-blur-text">${(analysis.qaTemplates || []).map(q =>
      `<div style="margin-bottom:8px"><strong>Q:</strong> ${esc(q.question)}<br/><strong>A:</strong> ${esc(q.answer)}</div>`
    ).join('') || 'AI-generated Q&A templates...'}</div>`;

  // Content Calendar
  document.getElementById('preview-calendar').innerHTML = `
    <div class="locked-blur-text">${(analysis.contentCalendar || []).map(c =>
      `<div style="margin-bottom:8px"><strong>${esc(c.week)} — ${esc(c.postType)}:</strong> ${esc(c.title)}</div>`
    ).join('') || 'AI-generated 4-week content calendar...'}</div>`;

  // Show results
  const el = document.getElementById('rc-results');
  el.style.display = 'block';
  requestAnimationFrame(() => {
    el.classList.add('fade-in');
    animateRing(total);
    // Animate bars
    document.querySelectorAll('.breakdown-bar-fill[data-pct]').forEach(bar => {
      setTimeout(() => { bar.style.width = bar.dataset.pct + '%'; }, 150);
    });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ── Form handling ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const form    = document.getElementById('rc-form');
  const btn     = document.getElementById('rc-submit-btn');
  const btnTxt  = document.getElementById('rc-btn-txt');
  const spinner = document.getElementById('rc-spinner');
  const errBox  = document.getElementById('rc-error');

  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
    errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function hideError() { errBox.style.display = 'none'; }

  function setBusy(busy) {
    btn.disabled = busy;
    btnTxt.textContent = busy ? 'Analyzing your profile…' : 'Analyze My Profile →';
    spinner.style.display = busy ? 'block' : 'none';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const businessName = document.getElementById('rc-biz').value.trim();
    const city         = document.getElementById('rc-city').value.trim();
    const category     = document.getElementById('rc-trade').value;
    const services     = document.getElementById('rc-services').value.trim();
    const currentDescription = document.getElementById('rc-desc').value.trim();
    const website      = document.getElementById('rc-website').value.trim();

    // Validation
    if (!businessName) { showError('Please enter your business name.'); return; }
    if (!city)         { showError('Please enter your city.'); return; }
    if (!category)     { showError('Please select your trade / category.'); return; }
    if (!services)     { showError('Please list the services you offer.'); return; }

    setBusy(true);

    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, category, city, services, currentDescription, website }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Analysis failed. Please try again.');
      }

      renderResults(data.analysis, businessName, city, category);

    } catch (err) {
      showError(err.message || 'Something went wrong. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  });

  // Reset
  document.getElementById('rc-reset-btn').addEventListener('click', () => {
    const el = document.getElementById('rc-results');
    el.style.display = 'none';
    el.classList.remove('fade-in');
    form.reset();
    hideError();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
