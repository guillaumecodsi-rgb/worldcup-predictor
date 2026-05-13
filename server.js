const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ JSONBin.io Cloud Database ============
const JSONBIN_ID = process.env.JSONBIN_ID || '69fdc4d3c0954111d8f460d4';
const JSONBIN_KEY = process.env.JSONBIN_KEY || '$2a$10$Ij.8HE/BbvlvgooDH6FdqOTN89OeHbWI5AIdZJEl1QUMj.GEAHlFG';
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;

const DB_PATH = path.join(__dirname, 'data', 'db.json');
let dbCache = null;
let saveTimeout = null;

function loadDB() {
  if (dbCache) return dbCache;
  // Load from local file on first call (populated from JSONBin at startup)
  if (fs.existsSync(DB_PATH)) {
    dbCache = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } else {
    dbCache = { players: [], matches: [], predictions: [], nextId: { player: 1, match: 1, prediction: 1 } };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(dbCache, null, 2));
  }
  return dbCache;
}

function saveDB(db) {
  dbCache = db;
  // Save locally immediately
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

  // Debounce cloud save — push to JSONBin every 3 seconds
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => syncToCloud(), 3000);
}

async function syncToCloud() {
  if (!dbCache) return;
  try {
    await fetch(JSONBIN_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify(dbCache)
    });
    console.log('☁️ Synced to JSONBin');
  } catch (err) {
    console.error('❌ JSONBin sync failed:', err.message);
  }
}

// On startup: pull latest from JSONBin
async function initFromCloud() {
  try {
    const response = await fetch(JSONBIN_URL + '/latest', {
      headers: { 'X-Master-Key': JSONBIN_KEY }
    });
    const data = await response.json();
    if (data.record && data.record.players) {
      dbCache = data.record;
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(dbCache, null, 2));
      console.log('☁️ Loaded from JSONBin:', dbCache.players.length, 'players,', dbCache.matches.length, 'matches');
    }
  } catch (err) {
    console.error('⚠️ Could not load from JSONBin, using local:', err.message);
  }
}

// ============ API ROUTES ============

// Register a new player
app.post('/api/players', (req, res) => {
  const { name, alias, country, team } = req.body;
  if (!name || !alias || !country || !team) {
    return res.status(400).json({ error: 'Name, login, country, and team are required' });
  }

  const db = loadDB();
  const exists = db.players.find(p => p.alias.toLowerCase() === alias.trim().toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'This login is already taken. Choose a different one.' });
  }

  const player = { id: db.nextId.player++, name: name.trim(), alias: alias.trim().toLowerCase(), country, team, created_at: new Date().toISOString() };
  db.players.push(player);
  saveDB(db);
  res.json(player);
});

// Get all players
app.get('/api/players', (req, res) => {
  const db = loadDB();
  res.json(db.players.sort((a, b) => a.name.localeCompare(b.name)));
});

// Login by alias
app.post('/api/players/login', (req, res) => {
  const { alias } = req.body;
  if (!alias) return res.status(400).json({ error: 'Login is required' });
  const db = loadDB();
  const player = db.players.find(p => p.alias.toLowerCase() === alias.trim().toLowerCase());
  if (!player) return res.status(404).json({ error: 'Login not found. Please register first.' });
  res.json(player);
});

// Get all matches
app.get('/api/matches', (req, res) => {
  const db = loadDB();
  res.json(db.matches.sort((a, b) => a.match_date.localeCompare(b.match_date) || a.id - b.id));
});

// Get upcoming (not completed) matches
app.get('/api/matches/upcoming', (req, res) => {
  const db = loadDB();
  const upcoming = db.matches.filter(m => !m.is_completed);
  res.json(upcoming.sort((a, b) => a.match_date.localeCompare(b.match_date)));
});

// Submit predictions (with 30-min cutoff enforcement)
app.post('/api/predictions', (req, res) => {
  const { player_id, predictions } = req.body;
  if (!player_id || !predictions || !Array.isArray(predictions)) {
    return res.status(400).json({ error: 'player_id and predictions array required' });
  }

  const db = loadDB();
  const now = new Date();
  let locked = [];

  for (const p of predictions) {
    const match = db.matches.find(m => m.id === p.match_id);
    if (!match) continue;

    // Check cutoff: midnight CET/CEST on the day of the match
    if (match.is_completed) {
      locked.push(match.team_home + ' vs ' + match.team_away);
      continue;
    }
    // Create match day midnight in Europe/Amsterdam timezone
    const matchDayStr = match.match_date + 'T00:00:00';
    const matchDayCET = new Date(new Date(matchDayStr).toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
    // Convert to comparable: get the actual UTC time when it's midnight in CET
    const cutoffParts = match.match_date.split('-');
    const cutoffDate = new Date(Date.UTC(
      parseInt(cutoffParts[0]), parseInt(cutoffParts[1]) - 1, parseInt(cutoffParts[2])
    ));
    // Subtract CET offset (UTC+1 in winter, UTC+2 in summer/CEST)
    // June-July is CEST (UTC+2), so midnight CET = 22:00 UTC the day before
    cutoffDate.setUTCHours(-2); // midnight CEST = 22:00 UTC previous day
    if (now >= cutoffDate) {
      locked.push(match.team_home + ' vs ' + match.team_away);
      continue;
    }

    const existing = db.predictions.find(pr => pr.player_id === player_id && pr.match_id === p.match_id);
    if (existing) {
      existing.predicted_home = p.predicted_home;
      existing.predicted_away = p.predicted_away;
    } else {
      db.predictions.push({
        id: db.nextId.prediction++,
        player_id,
        match_id: p.match_id,
        predicted_home: p.predicted_home,
        predicted_away: p.predicted_away,
        points_earned: 0,
        created_at: new Date().toISOString()
      });
    }
  }

  saveDB(db);
  const saved = predictions.length - locked.length;
  if (locked.length > 0 && saved === 0) {
    return res.status(400).json({ error: `All matches are locked (cutoff passed)` });
  }
  res.json({ success: true, count: saved, locked: locked.length });
});

// Get predictions for a player
app.get('/api/predictions/:playerId', (req, res) => {
  const db = loadDB();
  const playerId = parseInt(req.params.playerId);
  const playerPreds = db.predictions.filter(p => p.player_id === playerId);

  const result = playerPreds.map(p => {
    const match = db.matches.find(m => m.id === p.match_id);
    return { ...p, ...match, match_id: p.match_id };
  });

  res.json(result.sort((a, b) => (a.match_date || '').localeCompare(b.match_date || '')));
});

// Update match result (admin)
app.post('/api/matches/:matchId/result', (req, res) => {
  const { score_home, score_away } = req.body;
  const matchId = parseInt(req.params.matchId);

  if (score_home === undefined || score_away === undefined) {
    return res.status(400).json({ error: 'score_home and score_away required' });
  }

  const db = loadDB();
  const match = db.matches.find(m => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  match.score_home = score_home;
  match.score_away = score_away;
  match.is_completed = true;

  // Calculate points for all predictions on this match
  const matchPreds = db.predictions.filter(p => p.match_id === matchId);
  for (const pred of matchPreds) {
    const actualOutcome = Math.sign(score_home - score_away);
    const predictedOutcome = Math.sign(pred.predicted_home - pred.predicted_away);

    if (pred.predicted_home === score_home && pred.predicted_away === score_away) {
      pred.points_earned = 3; // Exact score
    } else if (actualOutcome === predictedOutcome) {
      pred.points_earned = 1; // Correct outcome
    } else {
      pred.points_earned = 0;
    }
  }

  saveDB(db);
  res.json({ success: true, predictions_scored: matchPreds.length });
});

// Leaderboard - Individual
app.get('/api/leaderboard/individual', (req, res) => {
  const db = loadDB();

  const leaderboard = db.players.map(p => {
    const preds = db.predictions.filter(pr => pr.player_id === p.id);
    const total_points = preds.reduce((sum, pr) => sum + pr.points_earned, 0) + (p.winner_bonus || 0);
    const exact_scores = preds.filter(pr => pr.points_earned === 3).length;
    const correct_outcomes = preds.filter(pr => pr.points_earned === 1).length;
    return {
      id: p.id,
      name: p.name,
      country: p.country,
      team: p.team,
      total_points,
      exact_scores,
      correct_outcomes,
      winner_bonus: p.winner_bonus || 0,
      total_predictions: preds.length
    };
  });

  leaderboard.sort((a, b) => b.total_points - a.total_points || b.exact_scores - a.exact_scores || a.name.localeCompare(b.name));
  res.json(leaderboard);
});

// Leaderboard - By Team
app.get('/api/leaderboard/team', (req, res) => {
  const db = loadDB();

  const teamMap = {};
  for (const p of db.players) {
    if (!teamMap[p.team]) teamMap[p.team] = { team: p.team, members: new Set(), total_points: 0, exact_scores: 0, correct_outcomes: 0 };
    teamMap[p.team].members.add(p.id);

    const preds = db.predictions.filter(pr => pr.player_id === p.id);
    for (const pr of preds) {
      teamMap[p.team].total_points += pr.points_earned;
      if (pr.points_earned === 3) teamMap[p.team].exact_scores++;
      if (pr.points_earned === 1) teamMap[p.team].correct_outcomes++;
    }
    teamMap[p.team].total_points += (p.winner_bonus || 0);
  }

  const leaderboard = Object.values(teamMap).map(t => ({
    team: t.team,
    member_count: t.members.size,
    total_points: t.total_points,
    avg_points_per_member: Math.round((t.total_points / t.members.size) * 10) / 10,
    exact_scores: t.exact_scores,
    correct_outcomes: t.correct_outcomes
  }));

  leaderboard.sort((a, b) => b.avg_points_per_member - a.avg_points_per_member || b.total_points - a.total_points);
  res.json(leaderboard);
});

// Seed matches endpoint (admin) - supports match_time
app.post('/api/admin/seed-matches', (req, res) => {
  const { matches } = req.body;
  if (!matches || !Array.isArray(matches)) {
    return res.status(400).json({ error: 'matches array required' });
  }

  const db = loadDB();
  let added = 0;

  for (const m of matches) {
    const exists = db.matches.find(em => {
      // Use match_number for knockout uniqueness, otherwise team+date
      if (m.match_number) return em.match_number === m.match_number;
      return em.team_home === m.team_home && em.team_away === m.team_away && em.match_date === m.match_date;
    });
    if (!exists) {
      db.matches.push({
        id: db.nextId.match++,
        match_date: m.match_date,
        match_time: m.match_time || null,
        match_number: m.match_number || null,
        group_stage: m.group_stage || null,
        team_home: m.team_home,
        team_away: m.team_away,
        score_home: null,
        score_away: null,
        is_completed: false
      });
      added++;
    } else {
      if (m.match_time && !exists.match_time) exists.match_time = m.match_time;
    }
  }

  saveDB(db);
  res.json({ success: true, added, total: db.matches.length });
});

// Standings API - computed from completed group stage matches
app.get('/api/standings', (req, res) => {
  const db = loadDB();

  // Build group standings from completed group stage matches
  const groups = {};

  // Initialize groups from all matches
  for (const m of db.matches) {
    if (!m.group_stage || !m.group_stage.startsWith('Group')) continue;
    const groupName = m.group_stage;
    if (!groups[groupName]) groups[groupName] = {};

    if (!groups[groupName][m.team_home]) {
      groups[groupName][m.team_home] = { name: m.team_home, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_diff: 0, points: 0 };
    }
    if (!groups[groupName][m.team_away]) {
      groups[groupName][m.team_away] = { name: m.team_away, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_diff: 0, points: 0 };
    }

    // Only count completed matches
    if (m.is_completed) {
      const home = groups[groupName][m.team_home];
      const away = groups[groupName][m.team_away];

      home.played++;
      away.played++;
      home.goals_for += m.score_home;
      home.goals_against += m.score_away;
      away.goals_for += m.score_away;
      away.goals_against += m.score_home;

      if (m.score_home > m.score_away) {
        home.won++; home.points += 3;
        away.lost++;
      } else if (m.score_home < m.score_away) {
        away.won++; away.points += 3;
        home.lost++;
      } else {
        home.drawn++; home.points += 1;
        away.drawn++; away.points += 1;
      }

      home.goal_diff = home.goals_for - home.goals_against;
      away.goal_diff = away.goals_for - away.goals_against;
    }
  }

  // Convert to sorted array
  const result = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, teams]) => ({
      name,
      teams: Object.values(teams).sort((a, b) => b.points - a.points || b.goal_diff - a.goal_diff || b.goals_for - a.goals_for || a.name.localeCompare(b.name))
    }));

  res.json(result);
});

// Delete a match (admin)
app.delete('/api/admin/matches/:matchId', (req, res) => {
  const matchId = parseInt(req.params.matchId);
  const db = loadDB();

  const matchIndex = db.matches.findIndex(m => m.id === matchId);
  if (matchIndex === -1) return res.status(404).json({ error: 'Match not found' });

  // Remove match and any predictions for it
  db.matches.splice(matchIndex, 1);
  db.predictions = db.predictions.filter(p => p.match_id !== matchId);

  saveDB(db);
  res.json({ success: true });
});

// Admin: Full reset
app.post('/api/admin/reset', (req, res) => {
  const db = { players: [], matches: [], predictions: [], nextId: { player: 1, match: 1, prediction: 1 } };

  // Re-seed matches from seed-data.json
  const seedData = require('./seed-data.json');
  for (const m of seedData) {
    db.matches.push({
      id: db.nextId.match++,
      match_date: m.match_date,
      match_time: m.match_time || null,
      match_number: m.match_number || null,
      group_stage: m.group_stage || null,
      team_home: m.team_home,
      team_away: m.team_away,
      score_home: null,
      score_away: null,
      is_completed: false
    });
  }

  saveDB(db);
  res.json({ success: true, matches: db.matches.length });
});

// Delete a player (admin)
app.delete('/api/admin/players/:playerId', (req, res) => {
  const playerId = parseInt(req.params.playerId);
  const db = loadDB();

  const playerIndex = db.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return res.status(404).json({ error: 'Player not found' });

  // Remove player and their predictions
  db.players.splice(playerIndex, 1);
  db.predictions = db.predictions.filter(p => p.player_id !== playerId);

  saveDB(db);
  res.json({ success: true });
});

// Save winner prediction
app.post('/api/predictions/winner', (req, res) => {
  const { player_id, winner_team } = req.body;
  if (!player_id || !winner_team) {
    return res.status(400).json({ error: 'player_id and winner_team required' });
  }

  const db = loadDB();
  const player = db.players.find(p => p.id === player_id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  player.winner_prediction = winner_team;
  saveDB(db);
  res.json({ success: true, winner_prediction: winner_team });
});

// Get winner prediction for a player
app.get('/api/predictions/winner/:playerId', (req, res) => {
  const db = loadDB();
  const player = db.players.find(p => p.id === parseInt(req.params.playerId));
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json({ winner_prediction: player.winner_prediction || null, winner_locked: player.winner_locked || false });
});

// Admin: Set tournament winner and award points
app.post('/api/admin/set-winner', (req, res) => {
  const { winner_team } = req.body;
  if (!winner_team) return res.status(400).json({ error: 'winner_team required' });

  const db = loadDB();
  db.tournament_winner = winner_team;

  // Award 5 points to players who predicted correctly
  let awarded = 0;
  for (const player of db.players) {
    if (player.winner_prediction && player.winner_prediction === winner_team) {
      player.winner_bonus = 5;
      awarded++;
    } else {
      player.winner_bonus = 0;
    }
  }

  saveDB(db);
  res.json({ success: true, winner: winner_team, players_awarded: awarded });
});

// Get tournament winner
app.get('/api/admin/winner', (req, res) => {
  const db = loadDB();
  res.json({ winner: db.tournament_winner || null });
});

// Admin: Lock all winner predictions
app.post('/api/admin/lock-winner-predictions', (req, res) => {
  const db = loadDB();
  let locked = 0;
  let blank = 0;

  for (const player of db.players) {
    player.winner_locked = true;
    if (player.winner_prediction && player.winner_prediction !== '') {
      locked++;
    } else {
      blank++;
    }
  }

  saveDB(db);
  res.json({ success: true, locked, blank });
});

// Update match teams (admin) - for filling in knockout TBD matches
app.post('/api/matches/:matchId/teams', (req, res) => {
  const { team_home, team_away } = req.body;
  const matchId = parseInt(req.params.matchId);

  if (!team_home || !team_away) {
    return res.status(400).json({ error: 'team_home and team_away required' });
  }

  const db = loadDB();
  const match = db.matches.find(m => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  match.team_home = team_home;
  match.team_away = team_away;

  saveDB(db);
  res.json({ success: true, match });
});

// Reset match result (admin)
app.post('/api/matches/:matchId/reset', (req, res) => {
  const matchId = parseInt(req.params.matchId);
  const db = loadDB();
  const match = db.matches.find(m => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  match.score_home = null;
  match.score_away = null;
  match.is_completed = false;

  // Reset points for all predictions on this match
  const matchPreds = db.predictions.filter(p => p.match_id === matchId);
  for (const pred of matchPreds) {
    pred.points_earned = 0;
  }

  saveDB(db);
  res.json({ success: true });
});

// Streaks & Expert picks for homepage
app.get('/api/stats/streaks', (req, res) => {
  const db = loadDB();
  
  // Get completed matches in chronological order
  const completedMatches = db.matches
    .filter(m => m.is_completed)
    .sort((a, b) => a.match_date.localeCompare(b.match_date) || a.id - b.id);

  if (completedMatches.length === 0) {
    return res.json({ streaks: [], experts: [] });
  }

  const playerStreaks = [];
  const playerExpertStreaks = [];

  for (const player of db.players) {
    const playerPreds = db.predictions.filter(pr => pr.player_id === player.id);
    const predMap = {};
    playerPreds.forEach(p => { predMap[p.match_id] = p; });

    // Calculate longest streak of correct predictions (points > 0)
    let currentStreak = 0;
    let longestStreak = 0;
    // Calculate longest streak of exact scores (points === 3)
    let currentExpert = 0;
    let longestExpert = 0;

    for (const match of completedMatches) {
      const pred = predMap[match.id];
      if (pred && pred.points_earned > 0) {
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }

      if (pred && pred.points_earned === 3) {
        currentExpert++;
        longestExpert = Math.max(longestExpert, currentExpert);
      } else {
        currentExpert = 0;
      }
    }

    if (longestStreak > 0) {
      playerStreaks.push({ name: player.name, streak: longestStreak, current: currentStreak });
    }
    if (longestExpert > 0) {
      playerExpertStreaks.push({ name: player.name, streak: longestExpert, current: currentExpert });
    }
  }

  playerStreaks.sort((a, b) => b.streak - a.streak || b.current - a.current);
  playerExpertStreaks.sort((a, b) => b.streak - a.streak || b.current - a.current);

  res.json({
    streaks: playerStreaks.slice(0, 10),
    experts: playerExpertStreaks.slice(0, 10)
  });
});

// Team stats for homepage
app.get('/api/stats/teams', (req, res) => {
  const db = loadDB();
  const predictableMatches = db.matches.filter(m => m.team_home !== 'TBD' && m.team_away !== 'TBD').length;

  const teamMap = {};
  for (const p of db.players) {
    if (!teamMap[p.team]) teamMap[p.team] = { team: p.team, count: 0, completed: 0 };
    teamMap[p.team].count++;

    // Check if this player has predictions for ALL predictable matches
    const playerPreds = db.predictions.filter(pr => pr.player_id === p.id);
    if (predictableMatches > 0 && playerPreds.length >= predictableMatches) {
      teamMap[p.team].completed++;
    }
  }

  const stats = Object.values(teamMap).map(t => ({
    team: t.team,
    count: t.count,
    completed: t.completed,
    completion_pct: t.count > 0 ? Math.round((t.completed / t.count) * 100) : 0
  }));

  stats.sort((a, b) => b.count - a.count);
  res.json({ teams: stats, total_players: db.players.length, total_matches: predictableMatches });
});

// Auto-seed matches on startup if database is empty
function autoSeed() {
  const db = loadDB();
  if (db.matches.length > 0) return; // Already seeded

  console.log('🌱 Auto-seeding matches...');

  const groupMatches = require('./seed-data.json');
  let added = 0;

  for (const m of groupMatches) {
    const exists = db.matches.find(em => {
      if (m.match_number) return em.match_number === m.match_number;
      return em.team_home === m.team_home && em.team_away === m.team_away && em.match_date === m.match_date;
    });
    if (!exists) {
      db.matches.push({
        id: db.nextId.match++,
        match_date: m.match_date,
        match_time: m.match_time || null,
        match_number: m.match_number || null,
        group_stage: m.group_stage || null,
        team_home: m.team_home,
        team_away: m.team_away,
        score_home: null,
        score_away: null,
        is_completed: false
      });
      added++;
    }
  }

  saveDB(db);
  console.log(`✅ Seeded ${added} matches`);
}

// Start server: load from cloud first, then seed if needed, then listen
async function start() {
  await initFromCloud();
  autoSeed();
  app.listen(PORT, () => {
    console.log(`⚽ World Cup Predictor running at http://localhost:${PORT}`);
  });
}

start();
