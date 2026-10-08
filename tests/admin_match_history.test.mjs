import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { isValidMatchCode } from '../src/utils/matchCode.ts';

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

test('ADMIN MATCH HISTORY ACCEPTANCE TEST SUITE', async (t) => {
  const testSuffix = Date.now();
  const createdMatchIds = [];
  const createdPlayerIds = [];
  let eventId = null;

  // Setup isolated test event
  const { data: newEv, error: evErr } = await supabase
    .from('events')
    .insert({
      name: `Match History Acceptance Event ${testSuffix}`,
      event_date: '2026-10-08',
      venue: 'Sports History Arena',
      sport: 'Badminton',
      configuration: {
        sports: {
          Badminton: {
            enabled: true,
            facilityType: 'Courts',
            facilityUnit: 'Court',
            facilityCount: 6,
            categories: ["Men's Singles", "Women's Singles", "Men's Doubles"]
          },
          'Table Tennis': {
            enabled: true,
            facilityType: 'Tables',
            facilityUnit: 'Table',
            facilityCount: 3,
            categories: ["Open Singles"]
          }
        }
      }
    })
    .select()
    .single();

  assert.ifError(evErr);
  eventId = newEv.id;

  // Helper to create test player
  async function createPlayer(name, code, sport = 'Badminton', category = "Men's Singles") {
    const { data, error } = await supabase
      .from('players')
      .insert([{
        event_id: eventId,
        employee_id: `HIST_${code}_${testSuffix}_${Math.random().toString(36).substring(2, 6)}`,
        name,
        sport,
        category,
        status: 'PRESENT',
        check_in_time: new Date().toISOString(),
        push_subscription: { _metadata: { gender: 'Male' } }
      }])
      .select()
      .single();

    assert.ifError(error);
    createdPlayerIds.push(data.id);
    return data;
  }

  // Teardown
  t.after(async () => {
    for (const mid of createdMatchIds) {
      try {
        await supabase.from('matches').delete().eq('id', mid);
      } catch {}
    }
    for (const pid of createdPlayerIds) {
      try {
        await supabase.from('notifications').delete().eq('player_id', pid);
        await supabase.from('players').delete().eq('id', pid);
      } catch {}
    }
    if (eventId) {
      try {
        await supabase.from('events').delete().eq('id', eventId);
      } catch {}
    }
  });

  let matchA = null; // scheduled
  let matchB = null; // live
  let matchC = null; // completed without referee result
  let matchD = null; // completed WITH referee result (Badminton, Round 1, Referee Ankur)
  let matchE = null; // completed WITH referee result (Table Tennis, Final, Referee Vikas)

  // TEST 1: Create scheduled match -> Not visible in Match History
  await t.test('Test 1: Create scheduled match -> Not visible in Match History', async () => {
    const p1 = await createPlayer('Player One', 'T1P1');
    const p2 = await createPlayer('Player Two', 'T1P2');

    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime: new Date(Date.now() + 3600000).toISOString(),
        team1_p1_id: p1.id,
        team2_p1_id: p2.id,
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    matchA = data.match;
    createdMatchIds.push(matchA.id);

    // Query Match History API
    const historyRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    assert.strictEqual(historyRes.status, 200);
    const historyData = await historyRes.json();

    const inHistory = (historyData.history || []).some((m) => m.match_code === matchA.match_code);
    assert.strictEqual(inHistory, false, 'Scheduled match must NOT appear in Match History');
  });

  // TEST 2: Start match -> Not visible in Match History
  await t.test('Test 2: Start match LIVE -> Not visible in Match History', async () => {
    const p1 = await createPlayer('Live Player 1', 'T2P1');
    const p2 = await createPlayer('Live Player 2', 'T2P2');

    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 2',
        playingArea: 'Court 2',
        scheduledTime: new Date(Date.now() + 7200000).toISOString(),
        team1_p1_id: p1.id,
        team2_p1_id: p2.id,
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    matchB = data.match;
    createdMatchIds.push(matchB.id);

    // Start live via referee API
    const startRes = await fetch(`${baseUrl}/api/referee/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: matchB.match_code,
        refereeName: 'Referee Ankur',
      })
    });
    assert.strictEqual(startRes.status, 200);

    // Verify still NOT in Match History
    const historyRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    const historyData = await historyRes.json();
    const inHistory = (historyData.history || []).some((m) => m.match_code === matchB.match_code);
    assert.strictEqual(inHistory, false, 'LIVE match must NOT appear in Match History');
  });

  // TEST 3: Complete match without referee result -> Not visible in Match History
  await t.test('Test 3: Complete match without referee result -> Not visible in Match History', async () => {
    const p1 = await createPlayer('Unref P1', 'T3P1');
    const p2 = await createPlayer('Unref P2', 'T3P2');

    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 3',
        scheduledTime: new Date(Date.now() + 10800000).toISOString(),
        team1_p1_id: p1.id,
        team2_p1_id: p2.id,
      })
    });
    assert.strictEqual(createRes.status, 200);
    const createData = await createRes.json();
    matchC = createData.match;
    createdMatchIds.push(matchC.id);

    // Mark completed directly in Supabase without referee result metadata
    await supabase.from('matches').update({ status: 'COMPLETED' }).eq('id', matchC.id);

    // Verify match is NOT in history because referee result is missing
    const historyRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    const historyData = await historyRes.json();
    const inHistory = (historyData.history || []).some((m) => m.match_code === matchC.match_code);
    assert.strictEqual(inHistory, false, 'Completed match without referee result must NOT appear in Match History');
  });

  // TEST 4: Referee completes match and successfully submits result -> Match appears in Match History
  let playerAnuj = null;
  let playerTannu = null;

  await t.test('Test 4: Referee completes match and submits result -> Match appears in Match History', async () => {
    playerAnuj = await createPlayer('Anuj Sharma', 'ANUJ');
    playerTannu = await createPlayer('Tannu Jha', 'TANNU');

    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime: new Date(Date.now() + 14400000).toISOString(),
        team1_p1_id: playerAnuj.id,
        team2_p1_id: playerTannu.id,
      })
    });
    assert.strictEqual(createRes.status, 200);
    const createData = await createRes.json();
    matchD = createData.match;
    createdMatchIds.push(matchD.id);

    // Start match
    await fetch(`${baseUrl}/api/referee/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: matchD.match_code,
        refereeName: 'Ankur',
      })
    });

    // Complete match with referee result
    const completeRes = await fetch(`${baseUrl}/api/referee/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: matchD.match_code,
        refereeName: 'Ankur',
        winningTeam: 'team1',
        winnerId: playerAnuj.id,
        scoreNotes: '21-18',
      })
    });
    assert.strictEqual(completeRes.status, 200);

    // Query Match History
    const historyRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    assert.strictEqual(historyRes.status, 200);
    const historyData = await historyRes.json();
    const found = (historyData.history || []).find((m) => m.match_code === matchD.match_code);
    assert.ok(found, 'Match must appear in Match History');
    assert.strictEqual(found.status, 'COMPLETED');
  });

  // TEST 5: Verify all information is correct
  await t.test('Test 5: Verify all entry information: Match Code, Sport, Category, Round, Play Area, Players, Referee, Winner, Result, Completed At', async () => {
    const historyRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    const historyData = await historyRes.json();
    const entry = (historyData.history || []).find((m) => m.match_code === matchD.match_code);

    assert.ok(entry);
    assert.strictEqual(entry.match_code, matchD.match_code);
    assert.strictEqual(entry.sport, 'Badminton');
    assert.strictEqual(entry.category, "Men's Singles");
    assert.strictEqual(entry.phase, 'Round 1');
    assert.strictEqual(entry.playing_area, 'Court 1');
    assert.ok(entry.players_display.includes('Anuj Sharma') && entry.players_display.includes('Tannu Jha'));
    assert.strictEqual(entry.referee_name, 'Ankur');
    assert.strictEqual(entry.winner_name, 'Anuj Sharma');
    assert.strictEqual(entry.score_notes, '21-18');
    assert.ok(entry.scheduled_time);
    assert.ok(entry.completed_at);
  });

  // TEST 6: Delete a scheduled match -> Does NOT appear in Match History
  await t.test('Test 6: Delete a scheduled match -> Does NOT appear in Match History', async () => {
    const p1 = await createPlayer('Del P1', 'T6P1');
    const p2 = await createPlayer('Del P2', 'T6P2');

    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 4',
        scheduledTime: new Date(Date.now() + 18000000).toISOString(),
        team1_p1_id: p1.id,
        team2_p1_id: p2.id,
      })
    });
    assert.strictEqual(createRes.status, 200);
    const createData = await createRes.json();
    const delMatch = createData.match;

    // Delete match
    await supabase.from('matches').delete().eq('id', delMatch.id);

    // Verify
    const historyRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    const historyData = await historyRes.json();
    const found = (historyData.history || []).some((m) => m.match_code === delMatch.match_code);
    assert.strictEqual(found, false, 'Deleted match must not appear in history');
  });

  // TEST 7: Reschedule a scheduled match -> Old scheduled match does NOT appear in Match History
  await t.test('Test 7: Reschedule a scheduled match -> Old scheduled match does NOT appear in history', async () => {
    const p1 = await createPlayer('Resched P1', 'T7P1');
    const p2 = await createPlayer('Resched P2', 'T7P2');

    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 5',
        scheduledTime: new Date(Date.now() + 20000000).toISOString(),
        team1_p1_id: p1.id,
        team2_p1_id: p2.id,
      })
    });
    assert.strictEqual(createRes.status, 200);
    const createData = await createRes.json();
    const reschedMatch = createData.match;
    createdMatchIds.push(reschedMatch.id);

    // Reschedule time on match record
    await supabase.from('matches').update({
      scheduled_time: new Date(Date.now() + 25000000).toISOString(),
      playing_area: 'Court 6',
    }).eq('id', reschedMatch.id);

    // Verify still not in history
    const historyRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    const historyData = await historyRes.json();
    const found = (historyData.history || []).some((m) => m.match_code === reschedMatch.match_code);
    assert.strictEqual(found, false, 'Rescheduled incomplete match must not appear in history');
  });

  // TEST 8: Submit the same referee result twice -> Only ONE history entry exists
  await t.test('Test 8: Submit the same referee result twice -> Exactly ONE history entry exists', async () => {
    // Re-submit result for matchD
    await fetch(`${baseUrl}/api/referee/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: matchD.match_code,
        refereeName: 'Ankur',
        winningTeam: 'team1',
        winnerId: playerAnuj.id,
        scoreNotes: '21-18',
      })
    });

    const historyRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    const historyData = await historyRes.json();
    const matchesWithCode = (historyData.history || []).filter((m) => m.match_code === matchD.match_code);
    assert.strictEqual(matchesWithCode.length, 1, 'Only ONE history entry must exist for a match');
  });

  // Setup second completed match for filter/search testing (Table Tennis, Final, Referee Vikas)
  let playerRohit = null;
  let playerPriya = null;

  await t.test('Setup second completed match: Table Tennis, Final, Referee Vikas', async () => {
    playerRohit = await createPlayer('Rohit Verma', 'ROHIT', 'Table Tennis', 'Open Singles');
    playerPriya = await createPlayer('Priya Singh', 'PRIYA', 'Table Tennis', 'Open Singles');

    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Table Tennis',
        category: 'Open Singles',
        phase: 'Final',
        playingArea: 'Table 1',
        scheduledTime: new Date(Date.now() + 30000000).toISOString(),
        team1_p1_id: playerRohit.id,
        team2_p1_id: playerPriya.id,
      })
    });
    assert.strictEqual(createRes.status, 200);
    const createData = await createRes.json();
    matchE = createData.match;
    createdMatchIds.push(matchE.id);

    // Start
    const startRes = await fetch(`${baseUrl}/api/referee/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: matchE.match_code,
        refereeName: 'Vikas',
      })
    });
    assert.strictEqual(startRes.status, 200);

    // Complete
    const completeRes = await fetch(`${baseUrl}/api/referee/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: matchE.match_code,
        refereeName: 'Vikas',
        winningTeam: 'team2',
        winnerId: playerPriya.id,
        scoreNotes: '11-9, 11-8',
      })
    });
    assert.strictEqual(completeRes.status, 200);
  });

  // TEST 9: Filter by Sport
  await t.test('Test 9: Filter by Sport -> Only selected sport appears', async () => {
    const res = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}&sport=Badminton`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.history.length > 0);
    assert.ok(data.history.every((m) => m.sport === 'Badminton'));
  });

  // TEST 10: Filter by Category
  await t.test('Test 10: Filter by Category -> Only selected category appears', async () => {
    const res = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}&category=Open%20Singles`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.history.length > 0);
    assert.ok(data.history.every((m) => m.category === 'Open Singles'));
  });

  // TEST 11: Filter by Round
  await t.test('Test 11: Filter by Round -> Only selected round appears', async () => {
    const res = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}&round=Final`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.history.length > 0);
    assert.ok(data.history.every((m) => m.phase === 'Final'));
  });

  // TEST 12: Filter by Referee
  await t.test('Test 12: Filter by Referee -> Only matches completed by selected referee appear', async () => {
    const res = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}&referee=Ankur`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.history.length > 0);
    assert.ok(data.history.every((m) => m.referee_name === 'Ankur'));
  });

  // TEST 13: Combine filters
  await t.test('Test 13: Combine filters -> All filters work together', async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/history?eventId=${eventId}&sport=Badminton&category=Men%27s%20Singles&round=Round%201&referee=Ankur`
    );
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.history.length, 1);
    assert.strictEqual(data.history[0].match_code, matchD.match_code);
  });

  // TEST 14: Search by Match Code
  await t.test('Test 14: Search by Match Code -> Correct match appears', async () => {
    const res = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}&search=${matchD.match_code.toLowerCase()}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.history.length, 1);
    assert.strictEqual(data.history[0].match_code, matchD.match_code);
  });

  // TEST 15: Search by player name
  await t.test('Test 15: Search by player name -> Correct completed matches appear', async () => {
    const res = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}&search=Priya`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.history.length, 1);
    assert.strictEqual(data.history[0].match_code, matchE.match_code);
  });

  // TEST 16: Refresh Match History -> Historical data persists
  await t.test('Test 16: Refresh Match History -> Historical data persists', async () => {
    const res1 = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    const data1 = await res1.json();

    const res2 = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    const data2 = await res2.json();

    assert.strictEqual(data1.history.length, data2.history.length);
    assert.deepStrictEqual(
      data1.history.map((m) => m.match_code),
      data2.history.map((m) => m.match_code),
      'History must remain persistent across refreshes'
    );
  });
});
