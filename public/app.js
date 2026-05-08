// ============ DATA ============

// FIFA World Cup 2026 participating nations with ISO country codes for flags
const COUNTRY_FLAGS = {
  "Algeria": "dz", "Argentina": "ar", "Australia": "au", "Austria": "at",
  "Belgium": "be", "Bosnia and Herzegovina": "ba", "Brazil": "br",
  "Cabo Verde": "cv", "Canada": "ca", "Colombia": "co", "Congo DR": "cd",
  "Côte d'Ivoire": "ci", "Croatia": "hr", "Curaçao": "cw", "Czechia": "cz",
  "Ecuador": "ec", "Egypt": "eg", "England": "gb-eng", "France": "fr",
  "Germany": "de", "Ghana": "gh", "Haiti": "ht", "IR Iran": "ir",
  "Iraq": "iq", "Japan": "jp", "Jordan": "jo", "Korea Republic": "kr",
  "Mexico": "mx", "Morocco": "ma", "Netherlands": "nl", "New Zealand": "nz",
  "Norway": "no", "Panama": "pa", "Paraguay": "py", "Portugal": "pt",
  "Qatar": "qa", "Saudi Arabia": "sa", "Scotland": "gb-sct", "Senegal": "sn",
  "South Africa": "za", "Spain": "es", "Sweden": "se", "Switzerland": "ch",
  "Tunisia": "tn", "Türkiye": "tr", "Uruguay": "uy", "USA": "us",
  "Uzbekistan": "uz"
};

const WORLD_CUP_COUNTRIES = Object.keys(COUNTRY_FLAGS).sort();

// Work teams
const TEAMS = ["NL", "BE", "PL", "IE", "SE", "ESM OOC", "PM", "SSR/SX", "Exports"];

// ============ STATE ============
let currentPlayer = null;

// ============ HELPERS ============
function getFlag(teamName) {
  const code = COUNTRY_FLAGS[teamName];
  if (!code) return '';
  return `<img src="https://flagcdn.com/24x18/${code}.png" alt="${teamName}" class="flag-icon" onerror="this.style.display='none'">`;
}

function isMatchLocked(match) {
  if (match.is_completed) return true;
  // TBD matches are always locked
  if (match.team_home === 'TBD' || match.team_away === 'TBD') return true;
  // Lock at midnight CET/CEST on the day of the match
  // World Cup is in June-July so CEST applies (UTC+2)
  // Midnight CEST = 22:00 UTC the previous day
  const parts = match.match_date.split('-');
  const cutoff = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
  cutoff.setUTCHours(-2); // midnight CEST
  return new Date() >= cutoff;
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  populateDropdowns();
  loadHeroLeaderboards();
  checkSession();
});

function populateDropdowns() {
  const countrySelect = document.getElementById('reg-country');
  WORLD_CUP_COUNTRIES.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    countrySelect.appendChild(opt);
  });

  const teamSelect = document.getElementById('reg-team');
  TEAMS.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    teamSelect.appendChild(opt);
  });
}

function checkSession() {
  const saved = localStorage.getItem('wc_player');
  if (saved) {
    currentPlayer = JSON.parse(saved);
    showLoggedIn();
  }
}

// Load team stats on homepage
async function loadHeroLeaderboards() {
  try {
    const [statsRes, streaksRes, indRes, teamRes] = await Promise.all([
      fetch('/api/stats/teams'),
      fetch('/api/stats/streaks'),
      fetch('/api/leaderboard/individual'),
      fetch('/api/leaderboard/team')
    ]);
    const data = await statsRes.json();
    const streakData = await streaksRes.json();
    const individuals = await indRes.json();
    const teams = await teamRes.json();

    const medals = ['🥇', '🥈', '🥉'];

    // Left panel: registered players per team
    const playersEl = document.getElementById('hero-lb-players');
    if (data.teams.length === 0) {
      playersEl.innerHTML = '<p class="lb-placeholder">No players yet — be the first!</p>';
    } else {
      playersEl.innerHTML = data.teams.map(t => `
        <div class="hero-lb-row">
          <span class="hero-lb-name">${t.team}</span>
          <span class="hero-lb-pts">${t.count}</span>
        </div>
      `).join('') + `
        <div class="hero-lb-row hero-lb-total">
          <span class="hero-lb-name"><strong>Total</strong></span>
          <span class="hero-lb-pts"><strong>${data.total_players}</strong></span>
        </div>`;
    }

    // Right panel: predictions complete per team
    const teamsEl = document.getElementById('hero-lb-teams');
    if (data.teams.length === 0) {
      teamsEl.innerHTML = '<p class="lb-placeholder">No players yet — be the first!</p>';
    } else {
      teamsEl.innerHTML = data.teams.map(t => `
        <div class="hero-lb-row">
          <span class="hero-lb-name">${t.team}</span>
          <span class="hero-lb-pts">${t.completed}/${t.count}</span>
        </div>
      `).join('');
    }

    // Top players leaderboard (center)
    const topPlayersEl = document.getElementById('hero-lb-top-players');
    if (individuals.length === 0 || individuals[0].total_points === 0) {
      topPlayersEl.innerHTML = '<p class="lb-placeholder">No scores yet — tournament hasn\'t started!</p>';
    } else {
      topPlayersEl.innerHTML = individuals.slice(0, 10).map((p, i) => `
        <div class="hero-lb-row">
          <span class="hero-lb-rank">${i < 3 ? medals[i] : i + 1}</span>
          <span class="hero-lb-name">${p.name}</span>
          <span class="hero-lb-pts">${p.total_points} pts</span>
        </div>
      `).join('');
    }

    // Top teams leaderboard (center)
    const topTeamsEl = document.getElementById('hero-lb-top-teams');
    if (teams.length === 0 || teams[0].total_points === 0) {
      topTeamsEl.innerHTML = '<p class="lb-placeholder">No scores yet — tournament hasn\'t started!</p>';
    } else {
      topTeamsEl.innerHTML = teams.slice(0, 10).map((t, i) => `
        <div class="hero-lb-row">
          <span class="hero-lb-rank">${i < 3 ? medals[i] : i + 1}</span>
          <span class="hero-lb-name">${t.team}</span>
          <span class="hero-lb-pts">${t.avg_points_per_member} avg</span>
        </div>
      `).join('');
    }

    // Top streaks (center)
    const topStreaksEl = document.getElementById('hero-lb-top-streaks');
    if (streakData.streaks.length === 0) {
      topStreaksEl.innerHTML = '<p class="lb-placeholder">No streaks yet — play to start!</p>';
    } else {
      topStreaksEl.innerHTML = streakData.streaks.slice(0, 10).map((s, i) => `
        <div class="hero-lb-row">
          <span class="hero-lb-rank">${i === 0 ? '🔥' : i + 1}</span>
          <span class="hero-lb-name">${s.name}</span>
          <span class="hero-lb-pts">${s.streak} games</span>
        </div>
      `).join('');
    }

    // Top experts (center)
    const topExpertsEl = document.getElementById('hero-lb-top-experts');
    if (streakData.experts.length === 0) {
      topExpertsEl.innerHTML = '<p class="lb-placeholder">No exact score streaks yet!</p>';
    } else {
      topExpertsEl.innerHTML = streakData.experts.slice(0, 10).map((s, i) => `
        <div class="hero-lb-row">
          <span class="hero-lb-rank">${i === 0 ? '🎯' : i + 1}</span>
          <span class="hero-lb-name">${s.name}</span>
          <span class="hero-lb-pts">${s.streak} in a row</span>
        </div>
      `).join('');
    }
  } catch (e) {
    // Silently fail on homepage
  }
}

function showRulesPage() {
  document.getElementById('homepage').style.display = 'none';
  document.getElementById('rules-join-page').style.display = 'block';
}

function toggleHeroLeaderboards() {
  const row = document.getElementById('hero-leaderboards-row');
  const btn = document.querySelector('.btn-show-leaderboards');
  if (row.style.display === 'none') {
    row.style.display = 'flex';
    btn.textContent = '📊 Hide Leaderboards';
  } else {
    row.style.display = 'none';
    btn.textContent = '📊 Show Leaderboards';
  }
}

function showAuth(tab) {
  document.getElementById('homepage').style.display = 'none';
  document.getElementById('rules-join-page').style.display = 'none';
  // If already logged in, go straight to predictions
  if (currentPlayer) {
    showLoggedIn();
    return;
  }
  document.getElementById('app-header').style.display = 'none';
  document.getElementById('app-main').style.display = 'block';
  document.getElementById('auth-section').style.display = 'block';
  if (tab === 'login') switchTab('login');
  else switchTab('register');
}

function goBackHome() {
  document.getElementById('app-main').style.display = 'none';
  document.getElementById('auth-section').style.display = 'none';
  document.getElementById('rules-join-page').style.display = 'none';
  document.getElementById('homepage').style.display = 'flex';
  loadHeroLeaderboards();
}

// ============ AUTH ============
function switchTab(tab) {
  document.querySelectorAll('#auth-section .tab').forEach(t => t.classList.remove('active'));
  if (tab === 'register') {
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    document.querySelectorAll('#auth-section .tab')[0].classList.add('active');
  } else {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.querySelectorAll('#auth-section .tab')[1].classList.add('active');
  }
}

async function register(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const alias = document.getElementById('reg-alias').value;
  const country = document.getElementById('reg-country').value;
  const team = document.getElementById('reg-team').value;

  try {
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, alias, country, team })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentPlayer = data;
    localStorage.setItem('wc_player', JSON.stringify(data));
    showToast('Welcome! You are registered 🎉', 'success');
    showLoggedIn();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function login(e) {
  e.preventDefault();
  const alias = document.getElementById('login-alias').value;

  try {
    const res = await fetch('/api/players/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentPlayer = data;
    localStorage.setItem('wc_player', JSON.stringify(data));
    showToast(`Welcome back, ${data.name}! ⚽`, 'success');
    showLoggedIn();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logout() {
  currentPlayer = null;
  localStorage.removeItem('wc_player');
  document.getElementById('app-header').style.display = 'none';
  document.getElementById('app-main').style.display = 'none';
  document.getElementById('predictions-section').style.display = 'none';
  document.getElementById('leaderboard-section').style.display = 'none';
  document.getElementById('standings-section').style.display = 'none';
  document.getElementById('rules-section').style.display = 'none';
  document.getElementById('rules-join-page').style.display = 'none';
  document.getElementById('homepage').style.display = 'flex';
  loadHeroLeaderboards();
}

function showLoggedIn() {
  document.getElementById('homepage').style.display = 'none';
  document.getElementById('rules-join-page').style.display = 'none';
  document.getElementById('auth-section').style.display = 'none';
  document.getElementById('app-header').style.display = 'block';
  document.getElementById('app-main').style.display = 'block';
  document.getElementById('player-badge').textContent = `${currentPlayer.name} (${currentPlayer.alias})`;
  showSection('predictions');
}

// ============ NAVIGATION ============
function showSection(section) {
  document.getElementById('predictions-section').style.display = 'none';
  document.getElementById('leaderboard-section').style.display = 'none';
  document.getElementById('standings-section').style.display = 'none';
  document.getElementById('rules-section').style.display = 'none';

  if (section === 'home') {
    document.getElementById('app-header').style.display = 'none';
    document.getElementById('app-main').style.display = 'none';
    document.getElementById('homepage').style.display = 'flex';
    loadHeroLeaderboards();
  } else if (section === 'predictions') {
    document.getElementById('predictions-section').style.display = 'block';
    loadMatches();
  } else if (section === 'leaderboard') {
    document.getElementById('leaderboard-section').style.display = 'block';
    loadLeaderboard('individual');
  } else if (section === 'standings') {
    document.getElementById('standings-section').style.display = 'block';
    loadStandings();
  } else if (section === 'rules') {
    document.getElementById('rules-section').style.display = 'block';
  }
}

// ============ PREDICTIONS ============
async function loadMatches() {
  const [matchesRes, predictionsRes] = await Promise.all([
    fetch('/api/matches'),
    fetch(`/api/predictions/${currentPlayer.id}`)
  ]);

  const matches = await matchesRes.json();
  const predictions = await predictionsRes.json();

  // Load winner prediction
  loadWinnerPrediction();

  const predMap = {};
  predictions.forEach(p => { predMap[p.match_id] = p; });

  const container = document.getElementById('matches-container');

  if (matches.length === 0) {
    container.innerHTML = '<p class="info-text">No matches scheduled yet. Check back soon!</p>';
    return;
  }

  // Group by date
  const grouped = {};
  matches.forEach(m => {
    const dateKey = m.match_date;
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(m);
  });

  let html = '';
  for (const [date, dateMatches] of Object.entries(grouped)) {
    const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric'
    });
    html += `<div class="match-group"><h3>📅 ${formattedDate}</h3>`;

    for (const m of dateMatches) {
      const pred = predMap[m.id];
      const locked = isMatchLocked(m);
      const homeVal = pred ? pred.predicted_home : '';
      const awayVal = pred ? pred.predicted_away : '';
      const disabled = locked ? 'disabled' : '';

      let statusBadge = '';
      if (m.is_completed && pred) {
        const pts = pred.points_earned;
        const cls = pts > 0 ? '' : 'zero';
        const label = pts === 3 ? '3 pts ✓✓' : pts === 1 ? '1 pt ✓' : '0 pts ✗';
        statusBadge = `<span class="points-badge ${cls}">${label}</span>`;
      } else if (m.team_home === 'TBD' || m.team_away === 'TBD') {
        statusBadge = `<span class="points-badge tbd">⏳ Teams TBD</span>`;
      } else if (locked && !m.is_completed) {
        statusBadge = `<span class="points-badge locked">🔒 Locked</span>`;
      }

      let resultInfo = '';
      if (m.is_completed) {
        resultInfo = `<span class="final-score">${m.score_home} - ${m.score_away}</span>`;
      }

      const timeDisplay = m.match_time ? m.match_time.slice(0, 5) : '';

      const isTBD = m.team_home === 'TBD' || m.team_away === 'TBD';

      html += `
        <div class="match-card ${m.is_completed ? 'completed' : ''} ${locked && !m.is_completed && !isTBD ? 'locked-match' : ''} ${isTBD ? 'tbd-match' : ''}" data-match-id="${m.id}">
          <span class="match-meta">${m.group_stage || ''} ${m.match_number ? '· Match ' + m.match_number : ''} ${timeDisplay}</span>
          <div class="match-teams">
            <span class="team-name home">${getFlag(m.team_home)} ${m.team_home}</span>
            <input type="number" class="score-input" min="0" max="20" value="${homeVal}" 
                   data-match="${m.id}" data-side="home" ${disabled}>
            <span class="vs">-</span>
            <input type="number" class="score-input" min="0" max="20" value="${awayVal}" 
                   data-match="${m.id}" data-side="away" ${disabled}>
            <span class="team-name away">${m.team_away} ${getFlag(m.team_away)}</span>
          </div>
          <div class="match-result">
            ${resultInfo}
            ${statusBadge}
          </div>
        </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;
  setupAutoSave();
}

async function submitPredictions() {
  const inputs = document.querySelectorAll('.score-input:not([disabled])');
  const predMap = {};

  inputs.forEach(input => {
    const matchId = input.dataset.match;
    const side = input.dataset.side;
    if (!predMap[matchId]) predMap[matchId] = {};
    predMap[matchId][side] = input.value;
  });

  const predictions = [];
  for (const [matchId, scores] of Object.entries(predMap)) {
    if (scores.home !== '' && scores.away !== '') {
      predictions.push({
        match_id: parseInt(matchId),
        predicted_home: parseInt(scores.home),
        predicted_away: parseInt(scores.away)
      });
    }
  }

  if (predictions.length === 0) {
    showToast('Enter at least one prediction!', 'error');
    return;
  }

  try {
    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: currentPlayer.id, predictions })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`${predictions.length} prediction(s) saved! 🎯`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Auto-save predictions when user changes a score
function setupAutoSave() {
  let autoSaveTimer = null;
  document.getElementById('matches-container').addEventListener('input', (e) => {
    if (e.target.classList.contains('score-input')) {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        autoSavePredictions();
      }, 2000); // Save 2 seconds after last input
    }
  });
}

async function autoSavePredictions() {
  const inputs = document.querySelectorAll('.score-input:not([disabled])');
  const predMap = {};

  inputs.forEach(input => {
    const matchId = input.dataset.match;
    const side = input.dataset.side;
    if (!predMap[matchId]) predMap[matchId] = {};
    predMap[matchId][side] = input.value;
  });

  const predictions = [];
  for (const [matchId, scores] of Object.entries(predMap)) {
    if (scores.home !== '' && scores.away !== '') {
      predictions.push({
        match_id: parseInt(matchId),
        predicted_home: parseInt(scores.home),
        predicted_away: parseInt(scores.away)
      });
    }
  }

  if (predictions.length === 0) return;

  try {
    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: currentPlayer.id, predictions })
    });
    if (res.ok) {
      showToast(`Auto-saved ${predictions.length} prediction(s) ✓`, 'success');
    }
  } catch (err) {
    // Silent fail on auto-save
  }
}

// Save on page leave
window.addEventListener('beforeunload', () => {
  if (currentPlayer && document.getElementById('predictions-section').style.display !== 'none') {
    // Synchronous save attempt using sendBeacon
    const inputs = document.querySelectorAll('.score-input:not([disabled])');
    const predMap = {};
    inputs.forEach(input => {
      const matchId = input.dataset.match;
      const side = input.dataset.side;
      if (!predMap[matchId]) predMap[matchId] = {};
      predMap[matchId][side] = input.value;
    });

    const predictions = [];
    for (const [matchId, scores] of Object.entries(predMap)) {
      if (scores.home !== '' && scores.away !== '') {
        predictions.push({ match_id: parseInt(matchId), predicted_home: parseInt(scores.home), predicted_away: parseInt(scores.away) });
      }
    }

    if (predictions.length > 0) {
      navigator.sendBeacon('/api/predictions', new Blob(
        [JSON.stringify({ player_id: currentPlayer.id, predictions })],
        { type: 'application/json' }
      ));
    }
  }
});

// ============ LEADERBOARD ============
function switchLeaderboard(type) {
  document.querySelectorAll('#leaderboard-section .tab').forEach(t => t.classList.remove('active'));
  document.getElementById('leaderboard-individual').style.display = 'none';
  document.getElementById('leaderboard-team').style.display = 'none';
  document.getElementById('leaderboard-streaks').style.display = 'none';
  document.getElementById('leaderboard-experts').style.display = 'none';

  const tabs = document.querySelectorAll('#leaderboard-section .tab');
  if (type === 'individual') {
    document.getElementById('leaderboard-individual').style.display = 'block';
    tabs[0].classList.add('active');
    loadLeaderboard('individual');
  } else if (type === 'team') {
    document.getElementById('leaderboard-team').style.display = 'block';
    tabs[1].classList.add('active');
    loadLeaderboard('team');
  } else if (type === 'streaks') {
    document.getElementById('leaderboard-streaks').style.display = 'block';
    tabs[2].classList.add('active');
    loadStreaksLeaderboard();
  } else if (type === 'experts') {
    document.getElementById('leaderboard-experts').style.display = 'block';
    tabs[3].classList.add('active');
    loadStreaksLeaderboard();
  }
}

async function loadLeaderboard(type) {
  const res = await fetch(`/api/leaderboard/${type}`);
  const data = await res.json();
  if (type === 'individual') {
    renderIndividualLeaderboard(data);
  } else {
    renderTeamLeaderboard(data);
  }
}

function renderIndividualLeaderboard(data) {
  const medals = ['🥇', '🥈', '🥉'];
  let html = `
    <table class="leaderboard-table">
      <thead><tr><th>#</th><th>Player</th><th>Country</th><th>Team</th><th>Points</th><th>Exact</th><th>Correct</th></tr></thead>
      <tbody>`;
  data.forEach((p, i) => {
    const rank = i < 3 ? `<span class="medal">${medals[i]}</span>` : i + 1;
    const isMe = currentPlayer && p.id === currentPlayer.id;
    const rowStyle = isMe ? 'style="background:rgba(212,175,55,0.2);color:white;"' : '';
    html += `<tr ${rowStyle}><td class="rank">${rank}</td><td>${p.name}</td><td>${getFlag(p.country)} ${p.country}</td><td>${p.team}</td><td class="points">${p.total_points}</td><td>${p.exact_scores}</td><td>${p.correct_outcomes}</td></tr>`;
  });
  html += '</tbody></table>';
  if (data.length === 0) html = '<p class="info-text">No predictions scored yet.</p>';
  document.getElementById('leaderboard-individual').innerHTML = html;
}

function renderTeamLeaderboard(data) {
  const medals = ['🥇', '🥈', '🥉'];
  let html = `
    <table class="leaderboard-table">
      <thead><tr><th>#</th><th>Team</th><th>Members</th><th>Avg Points</th><th>Total Points</th><th>Exact Scores</th></tr></thead>
      <tbody>`;
  data.forEach((t, i) => {
    const rank = i < 3 ? `<span class="medal">${medals[i]}</span>` : i + 1;
    html += `<tr><td class="rank">${rank}</td><td>${t.team}</td><td>${t.member_count}</td><td class="points">${t.avg_points_per_member}</td><td>${t.total_points}</td><td>${t.exact_scores}</td></tr>`;
  });
  html += '</tbody></table>';
  if (data.length === 0) html = '<p class="info-text">No team data yet.</p>';
  document.getElementById('leaderboard-team').innerHTML = html;
}

// ============ STREAKS LEADERBOARD ============
async function loadStreaksLeaderboard() {
  try {
    const res = await fetch('/api/stats/streaks');
    const data = await res.json();

    // Streaks tab
    const streaksEl = document.getElementById('leaderboard-streaks');
    if (data.streaks.length === 0) {
      streaksEl.innerHTML = '<p class="info-text">No streaks yet — predictions need to be scored first.</p>';
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      let html = `
        <p class="info-text">Longest run of consecutive correct predictions (outcome or exact score).</p>
        <table class="leaderboard-table">
          <thead><tr><th>#</th><th>Player</th><th>Longest Streak</th><th>Current Streak</th></tr></thead>
          <tbody>`;
      data.streaks.forEach((s, i) => {
        const rank = i < 3 ? `<span class="medal">${medals[i]}</span>` : i + 1;
        html += `<tr><td class="rank">${rank}</td><td>${s.name}</td><td class="points">${s.streak} games</td><td>${s.current > 0 ? '🔥 ' + s.current : '-'}</td></tr>`;
      });
      html += '</tbody></table>';
      streaksEl.innerHTML = html;
    }

    // Experts tab
    const expertsEl = document.getElementById('leaderboard-experts');
    if (data.experts.length === 0) {
      expertsEl.innerHTML = '<p class="info-text">No exact score streaks yet — keep predicting!</p>';
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      let html = `
        <p class="info-text">Longest run of consecutive exact score predictions (3 pts each).</p>
        <table class="leaderboard-table">
          <thead><tr><th>#</th><th>Player</th><th>Longest Streak</th><th>Current Streak</th></tr></thead>
          <tbody>`;
      data.experts.forEach((s, i) => {
        const rank = i < 3 ? `<span class="medal">${medals[i]}</span>` : i + 1;
        html += `<tr><td class="rank">${rank}</td><td>${s.name}</td><td class="points">${s.streak} in a row</td><td>${s.current > 0 ? '🎯 ' + s.current : '-'}</td></tr>`;
      });
      html += '</tbody></table>';
      expertsEl.innerHTML = html;
    }
  } catch (e) {
    document.getElementById('leaderboard-streaks').innerHTML = '<p class="info-text">Could not load streaks.</p>';
    document.getElementById('leaderboard-experts').innerHTML = '<p class="info-text">Could not load expert picks.</p>';
  }
}

// ============ STANDINGS ============
async function loadStandings() {
  const container = document.getElementById('standings-container');
  container.innerHTML = '<p class="info-text">Loading standings...</p>';

  try {
    const res = await fetch('/api/standings');
    const groups = await res.json();

    if (!Array.isArray(groups) || groups.length === 0) {
      container.innerHTML = '<p class="info-text">Standings will be available once the tournament starts.</p>';
      return;
    }

    let html = '';
    for (const group of groups) {
      html += `<div class="standings-group">
        <h3>${group.name}</h3>
        <table class="standings-table">
          <thead><tr><th></th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>`;
      group.teams.forEach((t, i) => {
        const qualified = i < 2 ? 'qualified' : i === 2 ? 'playoff' : '';
        html += `<tr class="${qualified}">
          <td>${i + 1}</td>
          <td>${getFlag(t.name)} ${t.name}</td>
          <td>${t.played}</td><td>${t.won}</td><td>${t.drawn}</td><td>${t.lost}</td>
          <td>${t.goals_for}</td><td>${t.goals_against}</td><td>${t.goal_diff}</td>
          <td class="points">${t.points}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p class="info-text">Could not load standings. Try again later.</p>';
  }
}

// ============ UTILS ============
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = 'toast'; }, 3000);
}

// ============ WINNER PREDICTION ============
async function loadWinnerPrediction() {
  const select = document.getElementById('winner-prediction');
  const submitBtn = document.getElementById('winner-submit-btn');
  const badge = document.getElementById('winner-saved-badge');

  // Populate dropdown if empty
  if (select.options.length <= 1) {
    WORLD_CUP_COUNTRIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      select.appendChild(opt);
    });
  }

  // Reset state
  select.value = '';
  select.disabled = false;
  submitBtn.style.display = 'inline-block';
  badge.style.display = 'none';

  try {
    const res = await fetch(`/api/predictions/winner/${currentPlayer.id}`);
    const data = await res.json();
    if (data.winner_locked || (data.winner_prediction && data.winner_prediction !== '')) {
      // Locked — either by player or by admin
      select.value = data.winner_prediction || '';
      select.disabled = true;
      submitBtn.style.display = 'none';
      badge.style.display = 'inline';
      if (data.winner_prediction) {
        badge.textContent = `✅ Locked: ${data.winner_prediction}`;
      } else {
        badge.textContent = `🔒 Locked (no pick made)`;
      }
    }
  } catch (e) {}
}

async function submitWinnerPrediction() {
  const select = document.getElementById('winner-prediction');
  const winner = select.value;
  if (!winner) { showToast('Select a team first!', 'error'); return; }

  if (!confirm(`Are you sure you want to lock "${winner}" as your World Cup winner? You cannot change this later!`)) return;

  try {
    const res = await fetch('/api/predictions/winner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: currentPlayer.id, winner_team: winner })
    });
    if (res.ok) {
      select.disabled = true;
      document.getElementById('winner-submit-btn').style.display = 'none';
      document.getElementById('winner-saved-badge').style.display = 'inline';
      document.getElementById('winner-saved-badge').textContent = `✅ Locked: ${winner}`;
      showToast(`Winner prediction locked: ${winner} 🏆`, 'success');
    }
  } catch (e) {
    showToast('Error saving prediction', 'error');
  }
}
