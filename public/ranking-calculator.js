/* ── Scoring ─────────────────────────────────────────────────────────────── */
function scoreReviewVolume(n) {
  if (n === 0)         return 0;
  if (n <= 5)          return 5;
  if (n <= 15)         return 10;
  if (n <= 30)         return 16;
  if (n <= 60)         return 22;
  if (n <= 100)        return 28;
  if (n <= 200)        return 32;
  return 35;
}

function scoreRating(r) {
  if (r < 4.0)         return 4;
  if (r <= 4.2)        return 8;
  if (r <= 4.5)        return 12;
  if (r <= 4.7)        return 16;
  if (r <= 4.9)        return 18;
  return 20;
}

function scoreResponse(v) {
  const map = { always: 20, sometimes: 10, rarely: 3, never: 0 };
  return map[v] ?? 0;
}

function scoreProfile(v) {
  const map = { full: 15, partial: 7, bare: 2 };
  return map[v] ?? 0;
}

function scorePosts(v) {
  const map = { weekly: 10, monthly: 6, rarely: 2, never: 0 };
  return map[v] ?? 0;
}

/* ── City-size benchmarks ────────────────────────────────────────────────── */
const benchmarks = {
  small:  { reviews: 45,  rating: 4.5, response: '90%+', label: 'small towns (under 50k)' },
  suburb: { reviews: 75,  rating: 4.6, response: '90%+', label: 'suburbs (50k–200k)' },
  mid:    { reviews: 130, rating: 4.7, response: '95%+', label: 'mid-size cities (200k–500k)' },
  major:  { reviews: 250, rating: 4.8, response: '99%+', label: 'major cities (500k+)' },
};

/* ── Color from score ─────────────────────────────────────────────────────── */
function scoreColor(s) {
  if (s < 40) return '#dc2626';
  if (s < 60) return '#ea580c';
  if (s < 75) return '#ca8a04';
  return '#059669';
}
function scoreGradeClass(s) {
  if (s < 40) return 'red';
  if (s < 60) return 'orange';
  if (s < 75) return 'yellow';
  return 'green';
}
function scoreVerdict(s) {
  if (s < 40) return "You're nearly invisible on Google Maps. Competitors are getting calls that should be yours.";
  if (s < 60) return "You're showing up, but losing leads to better-optimized competitors.";
  if (s < 75) return "You're competitive, but there are clear gaps holding you back from the top spot.";
  return "Strong profile! A few tweaks could lock in the #1 spot.";
}
function scoreGradeLabel(s) {
  if (s < 40) return 'Critical';
  if (s < 60) return 'Needs Work';
  if (s < 75) return 'Getting There';
  return 'Strong';
}

/* ── Animate score ring ──────────────────────────────────────────────────── */
function animateRing(score) {
  const circumference = 163;
  const ring = document.getElementById('score-ring-fg');
  const numEl = document.getElementById('score-ring-num');
  const color = scoreColor(score);

  ring.style.stroke = color;

  let current = 0;
  const duration = 1400;
  const start = performance.now();

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
    current = Math.round(eased * score);
    const offset = circumference - (circumference * eased * score) / 100;
    ring.style.strokeDashoffset = offset;
    numEl.textContent = current;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ── Animate breakdown bars ──────────────────────────────────────────────── */
function animateBars() {
  document.querySelectorAll('.breakdown-bar-fill[data-pct]').forEach(bar => {
    const pct = parseFloat(bar.dataset.pct);
    requestAnimationFrame(() => {
      setTimeout(() => { bar.style.width = pct + '%'; }, 100);
    });
  });
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function getRadioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function tradeLabel(value) {
  const map = {
    hvac: 'HVAC', plumbing: 'Plumbing', electrical: 'Electrical',
    roofing: 'Roofing', landscaping: 'Landscaping', pest: 'Pest Control',
    cleaning: 'House Cleaning', auto: 'Auto Repair', appliance: 'Appliance Repair',
    painting: 'Painting', flooring: 'Flooring', other: 'Local Service'
  };
  return map[value] || 'Local Service';
}

/* ── Build Issues ─────────────────────────────────────────────────────────── */
function buildIssues(data, bench, trade, city) {
  const issues = [];
  // Review volume
  if (data.reviews < bench.reviews) {
    issues.push({
      icon: '📊',
      text: `You only have <strong>${data.reviews} review${data.reviews !== 1 ? 's' : ''}</strong> — you need at least <strong>${bench.reviews}+</strong> to compete in ${bench.label}.`,
    });
  }
  // Rating
  if (data.rating < bench.rating) {
    issues.push({
      icon: '⭐',
      text: `Your <strong>${data.rating.toFixed(1)}★ rating</strong> is below the ${bench.label} average of <strong>${bench.rating}★</strong>.`,
    });
  }
  // Response rate
  if (data.response !== 'always') {
    issues.push({
      icon: '💬',
      text: `Not responding to every review costs you ranking points and signals to potential customers that you don't care.`,
    });
  }
  // Profile
  if (data.profile !== 'full') {
    issues.push({
      icon: '📋',
      text: `Your GBP profile is incomplete — Google rewards <strong>fully filled-out profiles</strong> with significantly higher rankings.`,
    });
  }
  // Posts
  if (data.posts === 'never' || data.posts === 'rarely') {
    issues.push({
      icon: '📝',
      text: `No regular Google Posts means you're missing a free, powerful ranking signal that your competitors may be using.`,
    });
  }
  return issues.slice(0, 3);
}

/* ── Build Gaps ───────────────────────────────────────────────────────────── */
function buildGaps(data, bench, score) {
  const gaps = [];
  const reviewDiff = bench.reviews - data.reviews;
  if (reviewDiff > 0) {
    gaps.push({ done: false, text: `Get <strong>${reviewDiff} more reviews</strong> to match the local leader (${bench.reviews}+ reviews)` });
  } else {
    gaps.push({ done: true, text: `Review volume is competitive — you have ${data.reviews} reviews` });
  }
  if (data.rating < bench.rating) {
    gaps.push({ done: false, text: `Improve your rating from <strong>${data.rating.toFixed(1)}★ to ${bench.rating}★</strong> — respond to negative reviews professionally` });
  } else {
    gaps.push({ done: true, text: `Rating of ${data.rating.toFixed(1)}★ is competitive for your market` });
  }
  if (data.response !== 'always') {
    gaps.push({ done: false, text: `<strong>Respond to 100% of reviews</strong> — top-ranked competitors respond to ${bench.response} of reviews` });
  } else {
    gaps.push({ done: true, text: `Response rate is excellent — you reply to all reviews` });
  }
  if (data.profile !== 'full') {
    gaps.push({ done: false, text: `<strong>Complete your GBP profile</strong> — add all services, hours, photos, and attributes` });
  } else {
    gaps.push({ done: true, text: `Profile completeness is strong` });
  }
  if (data.posts !== 'weekly') {
    gaps.push({ done: false, text: `<strong>Post on Google weekly</strong> — offers, updates, and tips are free ranking signals` });
  } else {
    gaps.push({ done: true, text: `Weekly posting cadence is great for ranking signals` });
  }
  return gaps;
}

/* ── Main calculate function ─────────────────────────────────────────────── */
function calculate() {
  const trade    = document.getElementById('rc-trade').value;
  const city     = document.getElementById('rc-city').value.trim() || 'your city';
  const citySize = document.getElementById('rc-city-size').value;
  const reviews  = parseInt(document.getElementById('rc-reviews').value, 10) || 0;
  const rating   = parseFloat(document.getElementById('rc-rating').value);
  const response = getRadioValue('response');
  const profile  = getRadioValue('profile');
  const posts    = getRadioValue('posts');

  if (!response || !profile || !posts) {
    return; // shouldn't happen — button won't be reached without selection
  }

  const data = { reviews, rating, response, profile, posts };

  const pts = {
    volume:   scoreReviewVolume(reviews),
    rating:   scoreRating(rating),
    response: scoreResponse(response),
    profile:  scoreProfile(profile),
    posts:    scorePosts(posts),
  };
  const total = pts.volume + pts.rating + pts.response + pts.profile + pts.posts;

  const bench = benchmarks[citySize];
  const tradeName = tradeLabel(trade);
  const issues = buildIssues(data, bench, tradeName, city);
  const gaps   = buildGaps(data, bench, total);

  renderResults({ total, pts, bench, tradeName, city, citySize, data, issues, gaps });
}

/* ── Render results ──────────────────────────────────────────────────────── */
function renderResults({ total, pts, bench, tradeName, city, citySize, data, issues, gaps }) {
  const maxPts = { volume: 35, rating: 20, response: 20, profile: 15, posts: 10 };
  const gradeClass = scoreGradeClass(total);
  const color = scoreColor(total);

  // Score ring card
  document.getElementById('res-grade').className = 'score-grade ' + gradeClass;
  document.getElementById('res-grade').textContent = scoreGradeLabel(total);
  document.getElementById('res-verdict').textContent = scoreVerdict(total);
  document.getElementById('res-meta').textContent = `${tradeName} in ${city} · Google Maps Ranking Score`;

  // Breakdown
  const breakdownData = [
    { label: 'Review Volume',      pts: pts.volume,   max: maxPts.volume,   id: 'bd-volume' },
    { label: 'Rating Quality',     pts: pts.rating,   max: maxPts.rating,   id: 'bd-rating' },
    { label: 'Response Rate',      pts: pts.response, max: maxPts.response, id: 'bd-response' },
    { label: 'Profile Complete',   pts: pts.profile,  max: maxPts.profile,  id: 'bd-profile' },
    { label: 'Content Activity',   pts: pts.posts,    max: maxPts.posts,    id: 'bd-posts' },
  ];
  const breakdownEl = document.getElementById('breakdown-grid');
  breakdownEl.innerHTML = breakdownData.map(item => {
    const pct = (item.pts / item.max) * 100;
    return `
      <div class="breakdown-item">
        <div class="breakdown-label">${item.label}</div>
        <div class="breakdown-pts">${item.pts}<span>/${item.max}</span></div>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar-fill" data-pct="${pct}" style="background:${pct >= 80 ? '#059669' : pct >= 50 ? '#f59e0b' : '#dc2626'}"></div>
        </div>
      </div>`;
  }).join('');

  // Competitor comparison
  document.getElementById('res-comp').innerHTML = `
    <div class="competitor-row">
      <div class="comp-icon them">🥇</div>
      <div class="comp-body">
        <div class="comp-label them">Top-Ranked ${tradeName} in ${bench.label}</div>
        <div class="comp-stat">${bench.reviews}+ reviews &nbsp;·&nbsp; ${bench.rating}★ average &nbsp;·&nbsp; responds to ${bench.response} of reviews &nbsp;·&nbsp; posts weekly</div>
      </div>
    </div>
    <div class="competitor-row">
      <div class="comp-icon you">📊</div>
      <div class="comp-body">
        <div class="comp-label you">Your Profile — ${city}</div>
        <div class="comp-stat">${data.reviews} reviews &nbsp;·&nbsp; ${data.rating.toFixed(1)}★ average &nbsp;·&nbsp; responds ${data.response === 'always' ? '100%' : data.response === 'sometimes' ? '~50%' : data.response === 'rarely' ? 'rarely' : 'never'} &nbsp;·&nbsp; posts ${data.posts}</div>
      </div>
    </div>`;

  // Issues
  const issuesEl = document.getElementById('res-issues');
  if (issues.length === 0) {
    issuesEl.innerHTML = '<p style="color:var(--green);font-weight:600">No critical issues found — your profile is strong!</p>';
  } else {
    issuesEl.innerHTML = issues.map(i => `
      <div class="issue-item">
        <div class="issue-icon">${i.icon}</div>
        <div class="issue-text">${i.text}</div>
      </div>`).join('');
  }

  // Gaps
  const gapsEl = document.getElementById('res-gaps');
  gapsEl.innerHTML = gaps.map(g => `
    <div class="gap-item">
      <div class="gap-check ${g.done ? 'done' : 'todo'}">${g.done ? '✓' : '!'}</div>
      <div>${g.text}</div>
    </div>`).join('');

  // Show results
  const resultsEl = document.getElementById('rc-results');
  resultsEl.style.display = 'block';
  requestAnimationFrame(() => {
    resultsEl.classList.add('fade-in');
    animateRing(total);
    animateBars();
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ── Form submit / spinner ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  // Slider live value
  const slider = document.getElementById('rc-rating');
  const sliderVal = document.getElementById('rc-rating-val');
  function updateSlider() {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
    sliderVal.textContent = val.toFixed(1) + '★';
  }
  slider.addEventListener('input', updateSlider);
  updateSlider();

  // Submit
  const form = document.getElementById('rc-form');
  const btn  = document.getElementById('rc-submit-btn');
  const btnTxt = document.getElementById('rc-btn-txt');
  const spinner = document.getElementById('rc-spinner');

  form.addEventListener('submit', e => {
    e.preventDefault();

    // Validate radios
    const response = document.querySelector('input[name="response"]:checked');
    const profile  = document.querySelector('input[name="profile"]:checked');
    const posts    = document.querySelector('input[name="posts"]:checked');
    if (!response || !profile || !posts) {
      const firstMissing = !response ? 'response' : !profile ? 'profile' : 'posts';
      const el = document.querySelector(`input[name="${firstMissing}"]`).closest('.rc-field');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.animation = 'none';
      el.offsetHeight; // reflow
      el.style.animation = 'shake .4s ease';
      return;
    }

    // Show spinner
    btn.disabled = true;
    btnTxt.textContent = 'Calculating…';
    spinner.style.display = 'block';

    // Fake 0.8s analysis delay for effect
    setTimeout(() => {
      btn.disabled = false;
      btnTxt.textContent = 'Calculate My Ranking Score →';
      spinner.style.display = 'none';
      calculate();
    }, 800);
  });

  // Reset
  document.getElementById('rc-reset-btn').addEventListener('click', () => {
    const resultsEl = document.getElementById('rc-results');
    resultsEl.style.display = 'none';
    resultsEl.classList.remove('fade-in');
    form.reset();
    updateSlider();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
