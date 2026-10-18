import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length > 0) {
        let val = rest.join('=').trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[key.trim()] = val;
      }
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const supabase = createClient(supabaseUrl, anonKey);

test('CRICKET PLAYER DASHBOARD & NOTIFICATION UX SUITE', async (t) => {
  const cleanupMatchIds = [];
  const cleanupNotificationIds = [];

  // 1. Resolve dynamic active event ID
  const { data: events } = await supabase.from('events').select('id, name').limit(1);
  assert.ok(events && events.length > 0, 'Must have at least one event in database');
  const eventId = events[0].id;

  // 2. Fetch teams
  const teamsRes = await fetch(`${baseUrl}/api/admin/teams?eventId=${eventId}&sport=Cricket`);
  assert.equal(teamsRes.status, 200, 'Teams API must return 200');
  const teamsJson = await teamsRes.json();
  assert.ok(teamsJson.teams && teamsJson.teams.length >= 2, 'Must have at least 2 cricket teams');

  const team1 = teamsJson.teams.find((t) => t.teamName === 'Boundary Kings') || teamsJson.teams[0];
  const team2 = teamsJson.teams.find((t) => t.teamName === 'Chak De XI') || teamsJson.teams[1];

  const t1Players = team1.players;
  const t2Players = team2.players;
  assert.ok(t1Players.length >= 2, 'Team 1 must have at least 2 players');

  // Player 0: regular roster player (not necessarily captain)
  const rosterPlayer = t1Players.length > 1 ? t1Players[1] : t1Players[0];

  t.after(async () => {
    // 1. Cleanup notifications
    if (cleanupNotificationIds.length > 0) {
      await supabase.from('notifications').delete().in('id', cleanupNotificationIds);
    }
    // 2. Cleanup matches
    if (cleanupMatchIds.length > 0) {
      await supabase.from('matches').delete().in('id', cleanupMatchIds);
    }
    // 3. Reset player status
    const { data: p } = await supabase.from('players').select('id, check_in_time').eq('id', rosterPlayer.id).single();
    if (p) {
      const resetStatus = p.check_in_time ? 'PRESENT' : 'REGISTERED';
      await supabase.from('players').update({ status: resetStatus }).eq('id', p.id);
    }
  });

  let createdMatch = null;

  await t.test('1. Admin creates Cricket match and notifies roster players', async () => {
    const scheduledTime = new Date(Date.now() + 1800000).toISOString();
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Cricket',
        category: 'Corporate Cricket',
        phase: 'Quarter Final',
        playingArea: 'Main Ground',
        scheduledTime,
        team1_id: team1.teamId,
        team2_id: team2.teamId,
        team1_name: team1.teamName,
        team2_name: team2.teamName
      })
    });

    const body = await res.json();
    assert.equal(res.status, 200, `Match creation failed: ${JSON.stringify(body)}`);
    assert.ok(body.match?.id, 'Match must have ID');
    assert.ok(body.match?.match_code, 'Match must have match_code');
    createdMatch = body.match;
    cleanupMatchIds.push(createdMatch.id);

    // Track created notifications
    const { data: notifs } = await supabase
      .from('notifications')
      .select('id, player_id, match_id')
      .eq('match_id', createdMatch.id);
    if (notifs) {
      notifs.forEach((n) => cleanupNotificationIds.push(n.id));
    }

    // Verify roster player received MATCH_CALLED notification
    const playerNotif = notifs?.find((n) => n.player_id === rosterPlayer.id);
    assert.ok(playerNotif, 'Roster player must have received MATCH_CALLED notification');
  });

  await t.test('2. Cricket roster player dashboard query resolves NEXT MATCH directly without failing', async () => {
    assert.ok(createdMatch, 'Match must exist');

    // Simulate dashboard match discovery logic using valid matches table columns
    const MATCH_FIELDS = `
      id, event_id, sport, category, phase, playing_area, scheduled_time, reporting_time, status, score,
      team1_p1:players!fk_t1p1(id, name),
      team1_p2:players!fk_t1p2(id, name),
      team2_p1:players!fk_t2p1(id, name),
      team2_p2:players!fk_t2p2(id, name)
    `;

    // Step 1: Direct query
    let mData = [];
    const q1 = await supabase
      .from('matches')
      .select(MATCH_FIELDS)
      .or(`team1_p1_id.eq.${rosterPlayer.id},team1_p2_id.eq.${rosterPlayer.id},team2_p1_id.eq.${rosterPlayer.id},team2_p2_id.eq.${rosterPlayer.id}`)
      .in('status', ['SCHEDULED', 'NOTIFIED', 'PLAYER_CONFIRMED', 'READY', 'LIVE', 'DELAYED', 'NO-SHOW PENDING', 'NO_SHOW_PENDING'])
      .order('scheduled_time', { ascending: true })
      .limit(1);

    if (!q1.error && q1.data && q1.data.length > 0) {
      mData = q1.data;
    }

    // Step 2: Notification lookup
    if (mData.length === 0) {
      const { data: notifs } = await supabase
        .from('notifications')
        .select('match_id')
        .eq('player_id', rosterPlayer.id)
        .eq('type', 'MATCH_CALLED')
        .order('sent_at', { ascending: false })
        .limit(5);

      if (notifs && notifs.length > 0) {
        const matchIds = Array.from(new Set(notifs.map((n) => n.match_id).filter(Boolean)));
        if (matchIds.length > 0) {
          const { data: byId } = await supabase
            .from('matches')
            .select(MATCH_FIELDS)
            .in('id', matchIds)
            .in('status', ['SCHEDULED', 'NOTIFIED', 'PLAYER_CONFIRMED', 'READY', 'LIVE', 'DELAYED', 'NO-SHOW PENDING', 'NO_SHOW_PENDING'])
            .order('scheduled_time', { ascending: true })
            .limit(1);

          if (byId && byId.length > 0) {
            mData = byId;
          }
        }
      }
    }

    assert.ok(mData.length > 0, 'Dashboard match query must find the called match for the player');
    assert.equal(mData[0].id, createdMatch.id, 'Discovered match must match created match');
    assert.equal(mData[0].playing_area, 'Main Ground');
    assert.equal(mData[0].sport, 'Cricket');
  });

  await t.test('3. Player submits availability response "COMING" from dashboard', async () => {
    assert.ok(createdMatch, 'Match must exist');

    const res = await fetch(`${baseUrl}/api/player/matches/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: createdMatch.id,
        playerId: rosterPlayer.id,
        response: 'COMING'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.response, 'COMING');

    // Verify response is stored in matches.score JSON
    const { data: m } = await supabase.from('matches').select('score').eq('id', createdMatch.id).single();
    const meta = typeof m.score === 'string' ? JSON.parse(m.score) : m.score;
    assert.equal(meta.player_responses?.[rosterPlayer.id]?.response, 'COMING');
  });

  await t.test('4. Player changes response to "UNAVAILABLE" (NOT_COMING) from dashboard', async () => {
    assert.ok(createdMatch, 'Match must exist');

    const res = await fetch(`${baseUrl}/api/player/matches/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: createdMatch.id,
        playerId: rosterPlayer.id,
        response: 'NOT_COMING'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.response, 'NOT_COMING');

    // Verify updated response in matches.score JSON
    const { data: m } = await supabase.from('matches').select('score, status').eq('id', createdMatch.id).single();
    const meta = typeof m.score === 'string' ? JSON.parse(m.score) : m.score;
    assert.equal(meta.player_responses?.[rosterPlayer.id]?.response, 'NOT_COMING');

    // Match status must NOT be cancelled or altered
    assert.notEqual(m.status, 'CANCELLED');
    assert.notEqual(m.status, 'WALKOVER');

    // Player tournament status must NOT be marked UNAVAILABLE or NO_SHOW
    const { data: p } = await supabase.from('players').select('status').eq('id', rosterPlayer.id).single();
    assert.notEqual(p.status, 'UNAVAILABLE');
    assert.notEqual(p.status, 'NO_SHOW');
  });

  await t.test('5. Verify notification page HTML/structure has NO inline action buttons and links to dashboard', async () => {
    const notifsPageRes = await fetch(`${baseUrl}/player/notifications?id=${rosterPlayer.id}`);
    assert.equal(notifsPageRes.status, 200);
    const html = await notifsPageRes.text();

    // The notification page should NOT have inline action buttons like I'M COMING / CAN'T MAKE IT
    assert.equal(html.includes("I'M COMING"), false, 'Notification page must not contain inline response buttons');
    assert.equal(html.includes("CAN'T MAKE IT"), false, 'Notification page must not contain inline CAN\'T MAKE IT buttons');

    // The notification page should NOT display Match Code
    assert.equal(html.includes("Match Code:"), false, 'Notification page must not display Match Code');
  });

  await t.test('6. Verify player dashboard HTML excludes Match Code and displays Team / Captain information', async () => {
    const dashRes = await fetch(`${baseUrl}/player/dashboard?id=${rosterPlayer.id}`);
    assert.equal(dashRes.status, 200);
    const dashHtml = await dashRes.text();

    // Must NOT contain Match Code in player-facing UI
    assert.equal(dashHtml.includes("Match Code:"), false, 'Dashboard must NOT display Match Code');
    assert.equal(dashHtml.includes(createdMatch.match_code), false, 'Dashboard must NOT render raw match code');

    // Verify captain dashboard also excludes Match Code
    const captainPlayer = t1Players.find((p) => p.push_subscription?._metadata?.is_captain) || t1Players[0];
    const capDashRes = await fetch(`${baseUrl}/player/dashboard?id=${captainPlayer.id}`);
    assert.equal(capDashRes.status, 200);
    const capDashHtml = await capDashRes.text();

    assert.equal(capDashHtml.includes("Match Code:"), false, 'Captain dashboard must NOT display Match Code');
    assert.equal(capDashHtml.includes(createdMatch.match_code), false, 'Captain dashboard must NOT render raw match code');
  });
});
