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

test('PLAYER PLAYING STATUS: Live match transitions, dropdown exclusion, and defense-in-depth', async (t) => {
  // 1. Ensure test event exists
  let { data: events } = await supabase.from('events').select('id').limit(1);
  if (!events || events.length === 0) {
    const { data: newEv } = await supabase.from('events').insert({
      name: 'Annual Sports Day Championship 2026',
      sport: 'Badminton',
      event_date: '2026-09-01',
      venue: 'Main Arena'
    }).select();
    events = newEv;
  }
  const eventId = events[0].id;

  const testSuffix = Date.now();
  const createdPlayerIds = [];
  const createdMatchIds = [];

  // Helper to create test player
  async function createPlayer(name, code, category = 'Men Singles', isCheckedIn = true) {
    const { data, error } = await supabase.from('players').insert([{
      event_id: eventId,
      employee_id: `PLAY_${code}_${testSuffix}`,
      name,
      sport: 'Badminton',
      category,
      status: isCheckedIn ? 'PRESENT' : 'REGISTERED',
      check_in_time: isCheckedIn ? new Date().toISOString() : null
    }]).select().single();
    assert.ifError(error);
    createdPlayerIds.push(data.id);
    return data;
  }

  t.after(async () => {
    for (const matchId of createdMatchIds) {
      await supabase.from('matches').delete().eq('id', matchId);
    }
    for (const pid of createdPlayerIds) {
      await supabase.from('notifications').delete().eq('player_id', pid);
      await supabase.from('players').delete().eq('id', pid);
    }
  });

  // Test 1: Start a singles match -> both players become PLAYING
  await t.test('1. Starting a singles match transitions match to LIVE and both players to PLAYING', async () => {
    const anuj = await createPlayer('Anuj Sharma', 'ANUJ');
    const rohit = await createPlayer('Rohit Verma', 'ROHIT');

    // Create scheduled match
    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime: new Date('2026-09-03T10:00:00Z').toISOString(),
        team1_p1_id: anuj.id,
        team2_p1_id: rohit.id
      })
    });
    const createData = await createRes.json();
    assert.equal(createRes.status, 200);
    const matchId = createData.match.id;
    createdMatchIds.push(matchId);

    // Start Live
    const startRes = await fetch(`${baseUrl}/api/matches/start-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId })
    });
    const startData = await startRes.json();
    assert.equal(startRes.status, 200);
    assert.equal(startData.match.status, 'LIVE');

    // Verify DB Match Status
    const { data: dbMatch } = await supabase.from('matches').select('status').eq('id', matchId).single();
    assert.equal(dbMatch.status, 'LIVE');

    // Verify both players in DB are PLAYING
    const { data: anujDb } = await supabase.from('players').select('status').eq('id', anuj.id).single();
    const { data: rohitDb } = await supabase.from('players').select('status').eq('id', rohit.id).single();
    assert.equal(anujDb.status, 'PLAYING', 'Anuj must be PLAYING');
    assert.equal(rohitDb.status, 'PLAYING', 'Rohit must be PLAYING');
  });

  // Test 2: Start a doubles match -> all 4 players become PLAYING
  await t.test('2. Starting a doubles match transitions match to LIVE and all 4 players to PLAYING', async () => {
    const p1 = await createPlayer('Doubles 1', 'D1', 'Men Doubles');
    const p2 = await createPlayer('Doubles 2', 'D2', 'Men Doubles');
    const p3 = await createPlayer('Doubles 3', 'D3', 'Men Doubles');
    const p4 = await createPlayer('Doubles 4', 'D4', 'Men Doubles');

    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Doubles',
        phase: 'Round 1',
        playingArea: 'Court 2',
        scheduledTime: new Date('2026-09-03T11:00:00Z').toISOString(),
        team1_p1_id: p1.id,
        team1_p2_id: p2.id,
        team2_p1_id: p3.id,
        team2_p2_id: p4.id
      })
    });
    const createData = await createRes.json();
    assert.equal(createRes.status, 200);
    const matchId = createData.match.id;
    createdMatchIds.push(matchId);

    // Start Live
    const startRes = await fetch(`${baseUrl}/api/matches/start-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId })
    });
    const startData = await startRes.json();
    assert.equal(startRes.status, 200);

    // Verify all 4 players are PLAYING
    const { data: all4 } = await supabase.from('players').select('id, name, status').in('id', [p1.id, p2.id, p3.id, p4.id]);
    assert.equal(all4.length, 4);
    for (const p of all4) {
      assert.equal(p.status, 'PLAYING', `${p.name} must be PLAYING`);
    }
  });

  // Test 3: Backend validation rejects match creation with a PLAYING player
  await t.test('3. Backend rejects any attempt to schedule a match containing a PLAYING player (HTTP 409)', async () => {
    const activePlayer = await createPlayer('Live Active Player', 'LAP');
    const opponent = await createPlayer('Opponent Player', 'OPP');
    const thirdPlayer = await createPlayer('Third Player', 'TP');

    // Create and start first match live
    const { data: liveMatch } = await supabase.from('matches').insert({
      event_id: eventId,
      sport: 'Badminton',
      category: 'Men Singles',
      phase: 'Round 1',
      playing_area: 'Court 1',
      scheduled_time: new Date('2026-09-03T12:00:00Z').toISOString(),
      team1_p1_id: activePlayer.id,
      team2_p1_id: opponent.id,
      status: 'SCHEDULED'
    }).select().single();
    createdMatchIds.push(liveMatch.id);

    await fetch(`${baseUrl}/api/matches/start-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: liveMatch.id })
    });

    // Attempt to schedule a match on Court 4 with activePlayer who is PLAYING
    const rejectRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 1',
        playingArea: 'Court 4',
        scheduledTime: new Date('2026-09-03T14:00:00Z').toISOString(),
        team1_p1_id: activePlayer.id,
        team2_p1_id: thirdPlayer.id
      })
    });
    const rejectData = await rejectRes.json();
    assert.equal(rejectRes.status, 409, `Expected HTTP 409 for PLAYING player, got: ${rejectRes.status}`);
    assert.ok(rejectData.error.includes('PLAYING') || rejectData.error.includes('Player conflict'));
  });

  // Test 4: Different PRESENT players can still be selected
  await t.test('4. Different PRESENT players can be scheduled without issues', async () => {
    const pX = await createPlayer('Player X', 'PX');
    const pY = await createPlayer('Player Y', 'PY');

    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 1',
        playingArea: 'Court 3',
        scheduledTime: new Date('2026-09-03T15:00:00Z').toISOString(),
        team1_p1_id: pX.id,
        team2_p1_id: pY.id
      })
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.match?.id);
    createdMatchIds.push(data.match.id);
  });

  // Test 5: Completing a live match returns players to PRESENT (not QUALIFIED/DISQUALIFIED) and makes them selectable again
  await t.test('5. Completing live match returns players to PRESENT and allows them to be selected again', async () => {
    const pM = await createPlayer('Player M', 'PM');
    const pN = await createPlayer('Player N', 'PN');

    // Create & Start Live Match
    const { data: match } = await supabase.from('matches').insert({
      event_id: eventId,
      sport: 'Badminton',
      category: 'Men Singles',
      phase: 'Round 1',
      playing_area: 'Court 1',
      scheduled_time: new Date('2026-09-03T16:00:00Z').toISOString(),
      team1_p1_id: pM.id,
      team2_p1_id: pN.id,
      status: 'SCHEDULED'
    }).select().single();
    createdMatchIds.push(match.id);

    await fetch(`${baseUrl}/api/matches/start-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: match.id })
    });

    // Complete the match
    const compRes = await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: match.id, winningTeam: 'team1', isWalkover: false })
    });
    const compData = await compRes.json();
    assert.equal(compRes.status, 200);
    assert.equal(compData.match.status, 'COMPLETED');

    // Verify players return to PRESENT
    const { data: pMAfter } = await supabase.from('players').select('status').eq('id', pM.id).single();
    const { data: pNAfter } = await supabase.from('players').select('status').eq('id', pN.id).single();
    assert.equal(pMAfter.status, 'PRESENT', 'Winner must return to PRESENT');
    assert.equal(pNAfter.status, 'PRESENT', 'Loser must return to PRESENT');
    assert.notEqual(pMAfter.status, 'QUALIFIED');
    assert.notEqual(pNAfter.status, 'DISQUALIFIED');

    // Verify Player M can now be scheduled for another match
    const pOther = await createPlayer('Other Competitor', 'OC');
    const resNext = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 2',
        playingArea: 'Court 2',
        scheduledTime: new Date('2026-09-03T18:00:00Z').toISOString(),
        team1_p1_id: pM.id,
        team2_p1_id: pOther.id
      })
    });
    const nextData = await resNext.json();
    assert.equal(resNext.status, 200, `Scheduling completed player failed: ${JSON.stringify(nextData)}`);
    assert.ok(nextData.match?.id);
    createdMatchIds.push(nextData.match.id);
  });
});
