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

test('CRICKET TWO-WAY PLAYER ↔ ADMIN RESPONSE SUITE', async (t) => {
  const cleanupMatchIds = [];
  const cleanupNotificationIds = [];
  const cleanupResponseMatchIds = [];

  // 1. Resolve dynamic active event ID
  const { data: events } = await supabase.from('events').select('id, name').limit(1);
  assert.ok(events && events.length > 0, 'Must have at least one event in database');
  const eventId = events[0].id;

  t.after(async () => {
    // 1. Cleanup match_player_responses
    if (cleanupResponseMatchIds.length > 0) {
      await supabase.from('match_player_responses').delete().in('match_id', cleanupResponseMatchIds);
    }
    // 2. Cleanup notifications
    if (cleanupNotificationIds.length > 0) {
      await supabase.from('notifications').delete().in('id', cleanupNotificationIds);
    }
    // 3. Cleanup matches
    if (cleanupMatchIds.length > 0) {
      await supabase.from('matches').delete().in('id', cleanupMatchIds);
    }
    // 4. Reset any CALLED players back to their attendance status
    const { data: calledPlayers } = await supabase
      .from('players')
      .select('id, check_in_time')
      .eq('event_id', eventId)
      .eq('status', 'CALLED');

    if (calledPlayers && calledPlayers.length > 0) {
      for (const p of calledPlayers) {
        const resetStatus = p.check_in_time ? 'PRESENT' : 'REGISTERED';
        await supabase.from('players').update({ status: resetStatus }).eq('id', p.id);
      }
    }
  });

  // 2. Retrieve Cricket teams via /api/admin/teams
  const teamsRes = await fetch(`${baseUrl}/api/admin/teams?eventId=${eventId}&sport=Cricket`);
  assert.equal(teamsRes.status, 200, 'Teams API must return 200');
  const teamsJson = await teamsRes.json();
  assert.ok(teamsJson.teams && teamsJson.teams.length >= 2, 'Must have at least 2 cricket teams');

  const team1 = teamsJson.teams.find((t) => t.teamName === 'Boundary Kings') || teamsJson.teams[0];
  const team2 = teamsJson.teams.find((t) => t.teamName === 'Chak De XI') || teamsJson.teams[1];

  const t1Players = team1.players;
  const t2Players = team2.players;

  assert.ok(t1Players && t1Players.length > 0, 'Team 1 must have players');
  assert.ok(t2Players && t2Players.length > 0, 'Team 2 must have players');

  let testMatch = null;

  await t.test('1. Create Cricket Match and verify NOTIFIED status and notifications', async () => {
    const scheduledTime = new Date(Date.now() + 3600000).toISOString();
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Cricket',
        category: 'Corporate Cricket',
        phase: 'Round 1',
        playingArea: 'Ground 1',
        scheduledTime,
        team1_id: team1.teamId,
        team2_id: team2.teamId,
        team1_name: team1.teamName,
        team2_name: team2.teamName
      })
    });

    const body = await res.json();
    assert.equal(res.status, 200, `Failed to create match: ${JSON.stringify(body)}`);
    assert.ok(body.match?.id, 'Created match must have id');
    testMatch = body.match;
    cleanupMatchIds.push(testMatch.id);
    cleanupResponseMatchIds.push(testMatch.id);

    // Verify notifications were created
    const { data: notifs } = await supabase
      .from('notifications')
      .select('id, player_id, match_id, type, message')
      .eq('match_id', testMatch.id);

    assert.ok(notifs && notifs.length > 0, 'Notifications must be created for players');
    notifs.forEach((n) => cleanupNotificationIds.push(n.id));

    // Verify via player notifications endpoint that notification is present with match_id and code
    const playerNotifRes = await fetch(`${baseUrl}/api/player/notifications?playerId=${t1Players[0].id}`);
    assert.equal(playerNotifRes.status, 200, 'Player notifications endpoint must return 200');
    const playerNotifJson = await playerNotifRes.json();
    const calledNotif = playerNotifJson.notifications.find((n) => n.match_id === testMatch.id);
    assert.ok(calledNotif, 'Player must receive MATCH_CALLED notification with match_id');
    assert.equal(calledNotif.message.includes(testMatch.match_code), false, 'Notification message must NOT contain internal match code');
    assert.ok(calledNotif.message.includes('Ground 1'), 'Notification message must contain playing area');
  });

  await t.test('2. Player submits response: "I\'M COMING" (COMING)', async () => {
    assert.ok(testMatch, 'testMatch must exist');
    const playerToRespond = t1Players[0];
    const originalStatus = playerToRespond.status;

    const res = await fetch(`${baseUrl}/api/player/matches/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: testMatch.id,
        playerId: playerToRespond.id,
        response: 'COMING'
      })
    });

    const body = await res.json();
    assert.equal(res.status, 200, `Player respond failed: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    assert.equal(body.response, 'COMING');

    // Verify matches.score metadata was synced
    const { data: updatedMatch } = await supabase
      .from('matches')
      .select('score, status')
      .eq('id', testMatch.id)
      .single();

    const scoreMeta = typeof updatedMatch.score === 'string' ? JSON.parse(updatedMatch.score) : updatedMatch.score;
    assert.ok(scoreMeta.player_responses, 'score must have player_responses');
    assert.equal(scoreMeta.player_responses[playerToRespond.id]?.response, 'COMING');

    // Verify player attendance status is NOT changed or corrupted
    const { data: pCheck } = await supabase
      .from('players')
      .select('status')
      .eq('id', playerToRespond.id)
      .single();

    assert.notEqual(pCheck.status, 'UNAVAILABLE', 'Player status must NOT be marked UNAVAILABLE');
    assert.notEqual(pCheck.status, 'NO_SHOW', 'Player status must NOT be marked NO_SHOW');
  });

  await t.test('3. Player changes response to "CAN\'T MAKE IT" (NOT_COMING)', async () => {
    assert.ok(testMatch, 'testMatch must exist');
    const playerToRespond = t1Players[0];

    const res = await fetch(`${baseUrl}/api/player/matches/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: testMatch.id,
        playerId: playerToRespond.id,
        response: 'NOT_COMING'
      })
    });

    const body = await res.json();
    assert.equal(res.status, 200, `Player change response failed: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    assert.equal(body.response, 'NOT_COMING');

    // Verify matches.score metadata updated to NOT_COMING
    const { data: updatedMatch } = await supabase
      .from('matches')
      .select('status, score')
      .eq('id', testMatch.id)
      .single();

    const scoreMeta = typeof updatedMatch.score === 'string' ? JSON.parse(updatedMatch.score) : updatedMatch.score;
    assert.equal(scoreMeta.player_responses[playerToRespond.id]?.response, 'NOT_COMING');

    // Verify match status is NOT cancelled or marked as unavailable
    assert.notEqual(updatedMatch.status, 'CANCELLED', 'Match must NOT be cancelled by player response');
    assert.notEqual(updatedMatch.status, 'PLAYER_UNAVAILABLE', 'Match must NOT become PLAYER_UNAVAILABLE for cricket');

    // Verify player is NOT globally marked as UNAVAILABLE or NO_SHOW
    const { data: pCheck } = await supabase
      .from('players')
      .select('status')
      .eq('id', playerToRespond.id)
      .single();

    assert.notEqual(pCheck.status, 'UNAVAILABLE', 'Player must NOT be globally marked UNAVAILABLE');
    assert.notEqual(pCheck.status, 'NO_SHOW', 'Player must NOT be marked NO_SHOW');
  });

  await t.test('4. Multiple players submit responses for both teams', async () => {
    assert.ok(testMatch, 'testMatch must exist');

    // Team 1 Player 1: COMING
    if (t1Players.length > 1) {
      await fetch(`${baseUrl}/api/player/matches/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: testMatch.id,
          playerId: t1Players[1].id,
          response: 'COMING'
        })
      });
    }

    // Team 2 Player 0: COMING
    await fetch(`${baseUrl}/api/player/matches/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: testMatch.id,
        playerId: t2Players[0].id,
        response: 'COMING'
      })
    });

    // Team 2 Player 1: NOT_COMING
    if (t2Players.length > 1) {
      await fetch(`${baseUrl}/api/player/matches/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: testMatch.id,
          playerId: t2Players[1].id,
          response: 'NOT_COMING'
        })
      });
    }
  });

  await t.test('5. Admin fetches match responses summary & team breakdowns', async () => {
    assert.ok(testMatch, 'testMatch must exist');

    const res = await fetch(`${baseUrl}/api/admin/matches/responses?matchId=${testMatch.id}`);
    const body = await res.json();

    assert.equal(res.status, 200, `Admin responses API failed: ${JSON.stringify(body)}`);
    assert.equal(body.matchId, testMatch.id);
    assert.equal(body.sport, 'Cricket');

    // Summary counts
    assert.ok(body.summary, 'Summary must exist');
    assert.equal(typeof body.summary.totalPlayers, 'number');
    assert.equal(typeof body.summary.coming, 'number');
    assert.equal(typeof body.summary.notComing, 'number');
    assert.equal(typeof body.summary.noResponse, 'number');

    assert.ok(body.summary.coming >= 2, 'Should have at least 2 players coming');
    assert.ok(body.summary.notComing >= 2, 'Should have at least 2 players not coming');

    // Teams structure
    assert.ok(body.teams?.team1, 'team1 must exist in breakdown');
    assert.ok(body.teams?.team2, 'team2 must exist in breakdown');
    assert.equal(body.teams.team1.teamName, team1.teamName);
    assert.equal(body.teams.team2.teamName, team2.teamName);

    // Verify player list in breakdown
    const t1BreakdownPlayers = body.teams.team1.players;
    assert.ok(t1BreakdownPlayers.length > 0, 'Team 1 breakdown players must not be empty');

    const firstPlayerEntry = t1BreakdownPlayers.find((p) => p.id === t1Players[0].id);
    assert.ok(firstPlayerEntry, 'First player must be in team 1 breakdown');
    assert.equal(firstPlayerEntry.response, 'NOT_COMING');

    const secondPlayerEntry = t1Players.length > 1 ? t1BreakdownPlayers.find((p) => p.id === t1Players[1].id) : null;
    if (secondPlayerEntry) {
      assert.equal(secondPlayerEntry.response, 'COMING');
    }
  });

  await t.test('6. Player response GET endpoint returns player\'s current response', async () => {
    assert.ok(testMatch, 'testMatch must exist');

    const res = await fetch(
      `${baseUrl}/api/player/matches/respond?matchId=${testMatch.id}&playerId=${t1Players[0].id}`
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.response, 'NOT_COMING');
    assert.ok(body.respondedAt, 'respondedAt timestamp must be present');
  });

  await t.test('7. Unauthorized/ineligible player response is rejected', async () => {
    assert.ok(testMatch, 'testMatch must exist');
    const fakePlayerId = '00000000-0000-0000-0000-000000000000';

    const res = await fetch(`${baseUrl}/api/player/matches/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: testMatch.id,
        playerId: fakePlayerId,
        response: 'COMING'
      })
    });

    assert.notEqual(res.status, 200, 'Should reject non-existent or ineligible player');
  });

  await t.test('8. Match lifecycle is NOT blocked and starts/completes cleanly under admin command', async () => {
    assert.ok(testMatch, 'testMatch must exist');

    // 1. Admin starts match LIVE
    const startRes = await fetch(`${baseUrl}/api/matches/start-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: testMatch.id })
    });

    const startBody = await startRes.json();
    assert.equal(startRes.status, 200, `Failed to start match: ${JSON.stringify(startBody)}`);
    assert.equal(startBody.match?.status, 'LIVE', 'Match must transition to LIVE');

    // 2. Admin completes match
    const completeRes = await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: testMatch.id,
        winningTeam: 'team1',
        isWalkover: false
      })
    });

    const completeBody = await completeRes.json();
    assert.equal(completeRes.status, 200, `Failed to complete match: ${JSON.stringify(completeBody)}`);

    const { data: finalMatch } = await supabase
      .from('matches')
      .select('status, winner_id')
      .eq('id', testMatch.id)
      .single();

    assert.equal(finalMatch.status, 'COMPLETED', 'Match must be COMPLETED');
  });
});
