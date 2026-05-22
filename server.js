const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fnvdbdwthynnkeiwhuvw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZudmRiZHd0aHlubmtlaXdodXZ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTQ0MDc2OCwiZXhwIjoyMDk1MDE2NzY4fQ.f8UST6fp7neyotBvn4xlQpP9R3N1fEc_udkZtEx2KK4';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ API ROUTES ============

// Register a new player
app.post('/api/players', async (req, res) => {
  const { name, alias, country, team } = req.body;
  if (!name || !alias || !country || !team) {
    return res.status(400).json({ error: 'Name, login, country, and team are required' });
  }

  const { data: existing } = await supabase.from('players').select('id').eq('alias', alias.trim().toLowerCase()).single();
  if (existing) {
    return res.status(409).json({ error: 'This login is already taken. Choose a different one.' });
  }

  const { data, error } = await supabase.from('players').insert({
    name: name.trim(),
    alias: alias.trim().toLowerCase(),
    country,
    team
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get all players
app.get('/api/players', async (req, res) => {
  const { data } = await supabase.from('players').select('*').order('name');
  res.json(data || []);
});

// Login by alias
app.post('/api/players/login', async (req, res) => {
  const { alias } = req.body;
  if (!alias) return res.status(400).json({ error: 'Login is required' });

  const { data } = await supabase.from('players').select('*').eq('alias', alias.trim().toLowerCase()).single();
  if (!data) return res.status(404).json({ error: 'Login not found. Please register first.' });
  res.json(data);
});

// Get all matches
app.get('/api/matches', async (req, res) => {
  const { data } = await supabase.from('matches').select('*').order('match_date').order('id');
  res.json(data || []);
});

// Get upcoming matches
app.get('/api/matches/upcoming', async (req, res) => {
  const { data } = await supabase.from('matches').select('*').eq('is_completed', false).order('match_date');
  res.json(data || []);
});

// Submit predictions (with midnight CEST cutoff)
app.post('/api/predictions', async (req, res) => {
  const { player_id, predictions } = req.body;
  if (!player_id || !predictions || !Array.isArray(predictions)) {
    return res.status(400).json({ error: 'player_id and predictions array required' });
  }

  const now = new Date();
  const { data: matches } = await supabase.from('matches').select('*');
  const matchMap = {};
  (matches || []).forEach(m => { matchMap[m.id] = m; });

  let locked = [];
  let toUpsert = [];

  for (const p of predictions) {
    const match = matchMap[p.match_id];
    if (!match) continue;

    // Check cutoff: midnight CEST on match day
    if (match.is_completed) { locked.push(match.team_home + ' vs ' + match.team_away); continue; }
    if (match.team_home === 'TBD' || match.team_away === 'TBD') { locked.push('TBD match'); continue; }

    const parts = match.match_date.split('-');
    const cutoff = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
    cutoff.setUTCHours(-2); // midnight CEST = 22:00 UTC previous day
    if (now >= cutoff) { locked.push(match.team_home + ' vs ' + match.team_away); continue; }

    toUpsert.push({
      player_id,
      match_id: p.match_id,
      predicted_home: p.predicted_home,
      predicted_away: p.predicted_away,
      points_earned: 0
    });
  }

  if (toUpsert.length > 0) {
    const { error } = await supabase.from('predictions')
      .upsert(toUpsert, { onConflict: 'player_id,match_id' });
    if (error) return res.status(500).json({ error: error.message });
  }

  const saved = toUpsert.length;
  if (locked.length > 0 && saved === 0) {
    return res.status(400).json({ error: 'All matches are locked (cutoff passed)' });
  }
  res.json({ success: true, count: saved, locked: locked.length });
});

// Get predictions for a player
app.get('/api/predictions/:playerId', async (req, res) => {
  const playerId = parseInt(req.params.playerId);
  const { data } = await supabase.from('predictions').select('*, matches(*)').eq('player_id', playerId);

  const result = (data || []).map(p => ({
    ...p,
    match_id: p.match_id,
    team_home: p.matches?.team_home,
    team_away: p.matches?.team_away,
    match_date: p.matches?.match_date,
    score_home: p.matches?.score_home,
    score_away: p.matches?.score_away,
    is_completed: p.matches?.is_completed,
    group_stage: p.matches?.group_stage,
    match_number: p.matches?.match_number,
    match_time: p.matches?.match_time
  }));

  res.json(result.sort((a, b) => (a.match_date || '').localeCompare(b.match_date || '')));
});

// Update match result (admin)
app.post('/api/matches/:matchId/result', async (req, res) => {
  const { score_home, score_away } = req.body;
  const matchId = parseInt(req.params.matchId);

  if (score_home === undefined || score_away === undefined) {
    return res.status(400).json({ error: 'score_home and score_away required' });
  }

  // Update match
  await supabase.from('matches').update({ score_home, score_away, is_completed: true }).eq('id', matchId);

  // Calculate points for all predictions on this match
  const { data: preds } = await supabase.from('predictions').select('*').eq('match_id', matchId);

  for (const pred of (preds || [])) {
    const actualOutcome = Math.sign(score_home - score_away);
    const predictedOutcome = Math.sign(pred.predicted_home - pred.predicted_away);
    let points = 0;

    if (pred.predicted_home === score_home && pred.predicted_away === score_away) {
      points = 3;
    } else if (actualOutcome === predictedOutcome) {
      points = 1;
    }

    await supabase.from('predictions').update({ points_earned: points }).eq('id', pred.id);
  }

  res.json({ success: true, predictions_scored: (preds || []).length });
});

// Leaderboard - Individual
app.get('/api/leaderboard/individual', async (req, res) => {
  const { data: players } = await supabase.from('players').select('*');
  const { data: predictions } = await supabase.from('predictions').select('*');

  const leaderboard = (players || []).map(p => {
    const preds = (predictions || []).filter(pr => pr.player_id === p.id);
    const total_points = preds.reduce((sum, pr) => sum + pr.points_earned, 0) + (p.winner_bonus || 0);
    return {
      id: p.id, name: p.name, country: p.country, team: p.team,
      total_points,
      exact_scores: preds.filter(pr => pr.points_earned === 3).length,
      correct_outcomes: preds.filter(pr => pr.points_earned === 1).length,
      winner_bonus: p.winner_bonus || 0,
      total_predictions: preds.length
    };
  });

  leaderboard.sort((a, b) => b.total_points - a.total_points || b.exact_scores - a.exact_scores || a.name.localeCompare(b.name));
  res.json(leaderboard);
});

// Leaderboard - By Team
app.get('/api/leaderboard/team', async (req, res) => {
  const { data: players } = await supabase.from('players').select('*');
  const { data: predictions } = await supabase.from('predictions').select('*');

  const teamMap = {};
  for (const p of (players || [])) {
    if (!teamMap[p.team]) teamMap[p.team] = { team: p.team, members: new Set(), total_points: 0, exact_scores: 0, correct_outcomes: 0 };
    teamMap[p.team].members.add(p.id);
    const preds = (predictions || []).filter(pr => pr.player_id === p.id);
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

// Standings - computed from completed group matches
app.get('/api/standings', async (req, res) => {
  const { data: matches } = await supabase.from('matches').select('*');
  const groups = {};

  for (const m of (matches || [])) {
    if (!m.group_stage || !m.group_stage.startsWith('Group')) continue;
    const groupName = m.group_stage;
    if (!groups[groupName]) groups[groupName] = {};
    if (!groups[groupName][m.team_home]) groups[groupName][m.team_home] = { name: m.team_home, played:0, won:0, drawn:0, lost:0, goals_for:0, goals_against:0, goal_diff:0, points:0 };
    if (!groups[groupName][m.team_away]) groups[groupName][m.team_away] = { name: m.team_away, played:0, won:0, drawn:0, lost:0, goals_for:0, goals_against:0, goal_diff:0, points:0 };

    if (m.is_completed) {
      const home = groups[groupName][m.team_home];
      const away = groups[groupName][m.team_away];
      home.played++; away.played++;
      home.goals_for += m.score_home; home.goals_against += m.score_away;
      away.goals_for += m.score_away; away.goals_against += m.score_home;
      if (m.score_home > m.score_away) { home.won++; home.points += 3; away.lost++; }
      else if (m.score_home < m.score_away) { away.won++; away.points += 3; home.lost++; }
      else { home.drawn++; home.points += 1; away.drawn++; away.points += 1; }
      home.goal_diff = home.goals_for - home.goals_against;
      away.goal_diff = away.goals_for - away.goals_against;
    }
  }

  const result = Object.entries(groups).sort(([a],[b]) => a.localeCompare(b)).map(([name, teams]) => ({
    name,
    teams: Object.values(teams).sort((a,b) => b.points - a.points || b.goal_diff - a.goal_diff || b.goals_for - a.goals_for)
  }));
  res.json(result);
});

// Streaks
app.get('/api/stats/streaks', async (req, res) => {
  const { data: players } = await supabase.from('players').select('*');
  const { data: matches } = await supabase.from('matches').select('*').eq('is_completed', true).order('match_date').order('id');
  const { data: predictions } = await supabase.from('predictions').select('*');

  const playerStreaks = [];
  const playerExpertStreaks = [];

  for (const player of (players || [])) {
    const predMap = {};
    (predictions || []).filter(pr => pr.player_id === player.id).forEach(p => { predMap[p.match_id] = p; });

    let currentStreak = 0, longestStreak = 0, currentExpert = 0, longestExpert = 0;
    for (const match of (matches || [])) {
      const pred = predMap[match.id];
      if (pred && pred.points_earned > 0) { currentStreak++; longestStreak = Math.max(longestStreak, currentStreak); } else { currentStreak = 0; }
      if (pred && pred.points_earned === 3) { currentExpert++; longestExpert = Math.max(longestExpert, currentExpert); } else { currentExpert = 0; }
    }
    if (longestStreak > 0) playerStreaks.push({ name: player.name, streak: longestStreak, current: currentStreak });
    if (longestExpert > 0) playerExpertStreaks.push({ name: player.name, streak: longestExpert, current: currentExpert });
  }

  playerStreaks.sort((a,b) => b.streak - a.streak);
  playerExpertStreaks.sort((a,b) => b.streak - a.streak);
  res.json({ streaks: playerStreaks.slice(0,10), experts: playerExpertStreaks.slice(0,10) });
});

// Team stats for homepage
app.get('/api/stats/teams', async (req, res) => {
  const { data: players } = await supabase.from('players').select('*');
  const { data: matches } = await supabase.from('matches').select('id').neq('team_home', 'TBD');
  const { data: predictions } = await supabase.from('predictions').select('player_id,match_id');
  const predictableMatches = (matches || []).length;

  const teamMap = {};
  for (const p of (players || [])) {
    if (!teamMap[p.team]) teamMap[p.team] = { team: p.team, count: 0, completed: 0 };
    teamMap[p.team].count++;
    const playerPreds = (predictions || []).filter(pr => pr.player_id === p.id);
    if (predictableMatches > 0 && playerPreds.length >= predictableMatches) teamMap[p.team].completed++;
  }

  const stats = Object.values(teamMap).map(t => ({ team: t.team, count: t.count, completed: t.completed, completion_pct: t.count > 0 ? Math.round((t.completed / t.count) * 100) : 0 }));
  stats.sort((a,b) => b.count - a.count);
  res.json({ teams: stats, total_players: (players || []).length, total_matches: predictableMatches });
});

// ============ WINNER PREDICTION ============
app.post('/api/predictions/winner', async (req, res) => {
  const { player_id, winner_team } = req.body;
  if (!player_id || !winner_team) return res.status(400).json({ error: 'player_id and winner_team required' });

  const { error } = await supabase.from('players').update({ winner_prediction: winner_team }).eq('id', player_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, winner_prediction: winner_team });
});

app.get('/api/predictions/winner/:playerId', async (req, res) => {
  const { data } = await supabase.from('players').select('winner_prediction,winner_locked').eq('id', parseInt(req.params.playerId)).single();
  if (!data) return res.status(404).json({ error: 'Player not found' });
  res.json({ winner_prediction: data.winner_prediction || null, winner_locked: data.winner_locked || false });
});

// Admin: Set tournament winner
app.post('/api/admin/set-winner', async (req, res) => {
  const { winner_team } = req.body;
  if (!winner_team) return res.status(400).json({ error: 'winner_team required' });

  const { data: players } = await supabase.from('players').select('*');
  let awarded = 0;
  for (const player of (players || [])) {
    const bonus = (player.winner_prediction === winner_team) ? 5 : 0;
    if (bonus > 0) awarded++;
    await supabase.from('players').update({ winner_bonus: bonus }).eq('id', player.id);
  }

  await supabase.from('settings').upsert({ key: 'tournament_winner', value: winner_team });
  res.json({ success: true, winner: winner_team, players_awarded: awarded });
});

app.get('/api/admin/winner', async (req, res) => {
  const { data } = await supabase.from('settings').select('value').eq('key', 'tournament_winner').single();
  res.json({ winner: data?.value || null });
});

// Admin: Lock all winner predictions
app.post('/api/admin/lock-winner-predictions', async (req, res) => {
  const { data: players } = await supabase.from('players').select('*');
  let locked = 0, blank = 0;
  for (const p of (players || [])) {
    await supabase.from('players').update({ winner_locked: true }).eq('id', p.id);
    if (p.winner_prediction) locked++; else blank++;
  }
  res.json({ success: true, locked, blank });
});

// ============ ADMIN: MATCH & PLAYER MANAGEMENT ============

// Update match teams (knockout TBD)
app.post('/api/matches/:matchId/teams', async (req, res) => {
  const { team_home, team_away } = req.body;
  const matchId = parseInt(req.params.matchId);
  if (!team_home || !team_away) return res.status(400).json({ error: 'team_home and team_away required' });

  const { error } = await supabase.from('matches').update({ team_home, team_away }).eq('id', matchId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Reset match result
app.post('/api/matches/:matchId/reset', async (req, res) => {
  const matchId = parseInt(req.params.matchId);
  await supabase.from('matches').update({ score_home: null, score_away: null, is_completed: false }).eq('id', matchId);
  await supabase.from('predictions').update({ points_earned: 0 }).eq('match_id', matchId);
  res.json({ success: true });
});

// Delete match
app.delete('/api/admin/matches/:matchId', async (req, res) => {
  const matchId = parseInt(req.params.matchId);
  await supabase.from('predictions').delete().eq('match_id', matchId);
  await supabase.from('matches').delete().eq('id', matchId);
  res.json({ success: true });
});

// Update player
app.put('/api/admin/players/:playerId', async (req, res) => {
  const playerId = parseInt(req.params.playerId);
  const { team, country, winner_prediction } = req.body;
  const updates = {};
  if (team) updates.team = team;
  if (country) updates.country = country;
  if (winner_prediction !== undefined) updates.winner_prediction = winner_prediction || null;

  const { error } = await supabase.from('players').update(updates).eq('id', playerId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Delete player
app.delete('/api/admin/players/:playerId', async (req, res) => {
  const playerId = parseInt(req.params.playerId);
  await supabase.from('predictions').delete().eq('player_id', playerId);
  await supabase.from('players').delete().eq('id', playerId);
  res.json({ success: true });
});

// Full reset
app.post('/api/admin/reset', async (req, res) => {
  await supabase.from('predictions').delete().neq('id', 0);
  await supabase.from('players').delete().neq('id', 0);
  await supabase.from('matches').delete().neq('id', 0);
  await supabase.from('settings').delete().neq('key', '');

  // Re-seed matches
  const seedData = require('./seed-data.json');
  const matchRows = seedData.map((m, i) => ({
    id: i + 1,
    match_date: m.match_date,
    match_time: m.match_time || null,
    match_number: m.match_number || null,
    group_stage: m.group_stage || null,
    team_home: m.team_home,
    team_away: m.team_away,
    score_home: null,
    score_away: null,
    is_completed: false
  }));

  await supabase.from('matches').insert(matchRows);
  res.json({ success: true, matches: matchRows.length });
});

// Seed matches (admin)
app.post('/api/admin/seed-matches', async (req, res) => {
  const { matches } = req.body;
  if (!matches || !Array.isArray(matches)) return res.status(400).json({ error: 'matches array required' });

  const { data: existing } = await supabase.from('matches').select('team_home,team_away,match_date,match_number');
  let added = 0;

  for (const m of matches) {
    const exists = (existing || []).find(em => {
      if (m.match_number) return em.match_number === m.match_number;
      return em.team_home === m.team_home && em.team_away === m.team_away && em.match_date === m.match_date;
    });
    if (!exists) {
      await supabase.from('matches').insert({
        match_date: m.match_date,
        match_time: m.match_time || null,
        match_number: m.match_number || null,
        group_stage: m.group_stage || null,
        team_home: m.team_home,
        team_away: m.team_away,
        is_completed: false
      });
      added++;
    }
  }
  res.json({ success: true, added, total: (existing || []).length + added });
});

// Start server
app.listen(PORT, () => {
  console.log(`⚽ World Cup Predictor running at http://localhost:${PORT}`);
});
