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

test('REFEREE MATCH CONTROL PORTAL ACCEPTANCE TEST SUITE', async (t) => {
  const testSuffix = Date.now();
  const createdMatchIds = [];
  const createdPlayerIds = [];
  let eventId = null;

  // Setup isolated test event
  const { data: newEv, error: evErr } = await supabase
    .from('events')
    .insert({
      name: `Referee Portal Test Event ${testSuffix}`,
      event_date: '2026-10-08',
      venue: 'Referee Championship Court',
      sport: 'Badminton',
      configuration: {
        sports: {
          Badminton: {
            enabled: true,
            facilityType: 'Courts',
            facilityUnit: 'Court',
            facilityCount: 4,
            categories: ["Men's Singles", "Women's Singles", "Men's Doubles"]
          }
        }
      }
    })
    .select()
    .single();

  assert.ifError(evErr);
  eventId = newEv.id;

  // Cleanup after all tests
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

  // Helper to create test player
  async function createPlayer(name, code, category = "Men's Singles", isCheckedIn = true) {
    const { data, error } = await supabase
      .from('players')
      .insert([{
        event_id: eventId,
        employee_id: `REF_${code}_${testSuffix}`,
        name,
        sport: 'Badminton',
        category,
        status: isCheckedIn ? 'PRESENT' : 'REGISTERED',
        check_in_time: isCheckedIn ? new Date().toISOString() : null,
        push_subscription: { _metadata: { gender: 'Male' } }
      }])
      .select()
      .single();

    assert.ifError(error);
    createdPlayerIds.push(data.id);
    return data;
  }

  const player1 = await createPlayer('Rahul Sharma', 'P1');
  const player2 = await createPlayer('Vikram Joshi', 'P2');
  let testMatch = null;
  let matchCode = null;

  // TEST 1: Admin creates a match -> 6-character Match Code is generated and persisted
  await t.test('1. Admin creates a match -> 6-character Match Code generated & persisted', async () => {
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
        team1_p1_id: player1.id,
        team2_p1_id: player2.id,
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.match);
    assert.ok(data.match.id);
    createdMatchIds.push(data.match.id);

    matchCode = data.match.match_code;
    assert.ok(matchCode, 'Match Code must be generated');
    assert.strictEqual(matchCode.length, 6, 'Match Code must be exactly 6 characters');
    assert.strictEqual(isValidMatchCode(matchCode), true, 'Match Code must conform to 6-char format');

    testMatch = data.match;
  });

  // TEST 2: Referee lookup with valid Match Code -> returns correct match information
  await t.test('2. Referee lookup with valid Match Code -> loads match details', async () => {
    const res = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: matchCode.toLowerCase(), // tests case-insensitivity
        refereeName: 'Official Referee',
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.match);
    assert.strictEqual(data.match.match_code, matchCode.toUpperCase());
    assert.strictEqual(data.match.sport, 'Badminton');
    assert.strictEqual(data.match.category, "Men's Singles");
    assert.strictEqual(data.match.playing_area, 'Court 1');
    assert.strictEqual(data.match.phase, 'Round 1');

    // Verify player names
    assert.strictEqual(data.match.team1[0].name, 'Rahul Sharma');
    assert.strictEqual(data.match.team2[0].name, 'Vikram Joshi');
  });

  // TEST 3: Referee lookup safety: No sensitive internal IDs (UUIDs, employee IDs, player codes) exposed
  await t.test('3. Referee lookup safety -> Sensitive employee IDs & player codes not exposed', async () => {
    const res = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode,
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const jsonStr = JSON.stringify(data);

    // Ensure employee_id is NOT leaked
    assert.strictEqual(jsonStr.includes(`REF_P1_${testSuffix}`), false, 'Employee ID must not be leaked');
    assert.strictEqual(jsonStr.includes(`REF_P2_${testSuffix}`), false, 'Employee ID must not be leaked');
  });

  // TEST 4: Referee lookup with non-existent Match Code -> returns 404 "Match not found"
  await t.test('4. Referee lookup with non-existent code -> clean 404 "Match not found"', async () => {
    const res = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: '999999', // valid format but does not exist
      }),
    });

    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.error, 'Match not found');
    assert.ok(data.message.includes('check the Match Code provided by the committee'));
  });

  // TEST 5: Referee lookup with invalid format Match Code -> rejected with 404/friendly message
  await t.test('5. Referee lookup with invalid format Match Code -> cleanly rejected', async () => {
    const res = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode: 'INVALID-CODE-TOO-LONG',
      }),
    });

    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.error, 'Match not found');
  });

  // TEST 6: Referee start match without referee name -> rejected with 400
  await t.test('6. Referee start match without referee name -> rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/referee/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode,
        refereeName: '   ', // empty string
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'Referee name is required');
  });

  // TEST 7: Referee start match with valid name and code -> transitions to LIVE and records referee name
  await t.test('7. Referee start match -> match status transitions to LIVE, referee name recorded', async () => {
    const res = await fetch(`${baseUrl}/api/referee/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode,
        refereeName: 'Referee Amit',
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.match.status, 'LIVE');
    assert.strictEqual(data.match.referee_name, 'Referee Amit');

    // Verify DB match record directly
    const { data: dbMatch } = await supabase.from('matches').select('*').eq('id', testMatch.id).single();
    assert.strictEqual(dbMatch.status, 'LIVE');
  });

  // TEST 8: Player status on match start -> both participating players transition to PLAYING
  await t.test('8. Player status on start -> participating players transition to PLAYING', async () => {
    const { data: p1Db } = await supabase.from('players').select('status').eq('id', player1.id).single();
    const { data: p2Db } = await supabase.from('players').select('status').eq('id', player2.id).single();

    assert.strictEqual(p1Db.status, 'PLAYING');
    assert.strictEqual(p2Db.status, 'PLAYING');
  });

  // TEST 9: Attempting to complete match without winner selection -> returns 400
  await t.test('9. Complete match without selecting winner -> rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/referee/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode,
        refereeName: 'Referee Amit',
        winningTeam: 'invalid_team',
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'Winner selection required');
  });

  // TEST 10: Complete match with winner selection & score notes -> transitions to COMPLETED
  await t.test('10. Complete match -> status COMPLETED, winner & score recorded', async () => {
    const res = await fetch(`${baseUrl}/api/referee/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode,
        refereeName: 'Referee Amit',
        winningTeam: 'team1',
        winnerId: player1.id,
        scoreNotes: '21-18, 21-19',
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.match.status, 'COMPLETED');
    assert.strictEqual(data.match.winner_name, 'Rahul Sharma');
    assert.strictEqual(data.match.score_notes, '21-18, 21-19');
    assert.strictEqual(data.match.referee_name, 'Referee Amit');

    // Verify DB match record directly
    const { data: dbMatch } = await supabase.from('matches').select('*').eq('id', testMatch.id).single();
    assert.strictEqual(dbMatch.status, 'COMPLETED');
    assert.strictEqual(dbMatch.winner_id, player1.id);
  });

  // TEST 11: Player status on completion -> participating players return to PRESENT (preserving attendance)
  await t.test('11. Player status on completion -> participating players return to PRESENT', async () => {
    const { data: p1Db } = await supabase.from('players').select('status').eq('id', player1.id).single();
    const { data: p2Db } = await supabase.from('players').select('status').eq('id', player2.id).single();

    assert.strictEqual(p1Db.status, 'PRESENT', 'Winner returns to PRESENT status');
    assert.strictEqual(p2Db.status, 'PRESENT', 'Loser returns to PRESENT status (preserves attendance, no elimination)');
  });

  // TEST 12: Concluded match protections: Cannot restart completed match & reload persists completed state
  await t.test('12. Concluded match protections -> cannot restart, re-lookup returns completed state', async () => {
    // Attempt to restart completed match
    const restartRes = await fetch(`${baseUrl}/api/referee/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode,
        refereeName: 'Referee Amit',
      }),
    });

    assert.strictEqual(restartRes.status, 400);
    const restartData = await restartRes.json();
    assert.strictEqual(restartData.error, 'Match already concluded');

    // Attempt to complete an already completed match
    const reCompleteRes = await fetch(`${baseUrl}/api/referee/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchCode,
        winningTeam: 'team2',
      }),
    });

    assert.strictEqual(reCompleteRes.status, 400);
    const reCompleteData = await reCompleteRes.json();
    assert.strictEqual(reCompleteData.error, 'Match already concluded');

    // Lookup again -> returns concluded state with all details
    const lookupRes = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchCode }),
    });

    assert.strictEqual(lookupRes.status, 200);
    const lookupData = await lookupRes.json();
    assert.strictEqual(lookupData.match.status, 'COMPLETED');
    assert.strictEqual(lookupData.match.winner_name, 'Rahul Sharma');
    assert.strictEqual(lookupData.match.score_notes, '21-18, 21-19');
    assert.strictEqual(lookupData.match.referee_name, 'Referee Amit');
  });

  // TEST 13: Refresh simulation -> multiple lookups return same match without duplicate writes
  await t.test('13. Refresh simulation -> multiple re-lookups return identical match data', async () => {
    // 1st simulated refresh
    const r1 = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchCode }),
    });
    const d1 = await r1.json();
    assert.strictEqual(r1.status, 200);

    // 2nd simulated refresh
    const r2 = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchCode }),
    });
    const d2 = await r2.json();
    assert.strictEqual(r2.status, 200);

    // 3rd simulated refresh
    const r3 = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchCode }),
    });
    const d3 = await r3.json();
    assert.strictEqual(r3.status, 200);

    assert.strictEqual(d1.match.match_code, d2.match.match_code);
    assert.strictEqual(d2.match.match_code, d3.match.match_code);
    assert.strictEqual(d1.match.status, 'COMPLETED');
    assert.strictEqual(d2.match.status, 'COMPLETED');
    assert.strictEqual(d3.match.status, 'COMPLETED');
  });

  // TEST 14: Enter a different Match Code -> loads second match and persists across refresh
  await t.test('14. Switch to different Match Code -> loads new match and preserves it across refresh', async () => {
    const p3 = await createPlayer('Player Three', 'P3');
    const p4 = await createPlayer('Player Four', 'P4');

    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 2',
        playingArea: 'Court 3',
        scheduledTime: new Date(Date.now() + 7200000).toISOString(),
        team1_p1_id: p3.id,
        team2_p1_id: p4.id,
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const newMatchCode = data.match.match_code;
    createdMatchIds.push(data.match.id);

    // Lookup new match
    const lookup1 = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchCode: newMatchCode, refereeName: 'Referee Ankur' }),
    });
    assert.strictEqual(lookup1.status, 200);
    const lookup1Data = await lookup1.json();
    assert.strictEqual(lookup1Data.match.match_code, newMatchCode);
    assert.strictEqual(lookup1Data.match.status, 'NOTIFIED');

    // Simulated refresh on new match
    const refreshLookup = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchCode: newMatchCode, refereeName: 'Referee Ankur' }),
    });
    assert.strictEqual(refreshLookup.status, 200);
    const refreshData = await refreshLookup.json();
    assert.strictEqual(refreshData.match.match_code, newMatchCode);
    assert.strictEqual(refreshData.match.team1[0].name, 'Player Three');
    assert.strictEqual(refreshData.match.team2[0].name, 'Player Four');
  });

  // TEST 15: Invalid or deleted Match Code on restore -> rejected with 404
  await t.test('15. Invalid / deleted Match Code on restore -> rejected with 404 and friendly error', async () => {
    const res = await fetch(`${baseUrl}/api/referee/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchCode: 'NONEX9' }),
    });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.error, 'Match not found');
  });
});
