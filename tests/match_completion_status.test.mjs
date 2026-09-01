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

test('MATCH COMPLETION: Reset participating players without automated tournament progression', async (t) => {
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

  // Helper to create test player with specific attendance state
  async function createPlayer(name, code, isCheckedIn = true, category = 'Men Singles') {
    const { data, error } = await supabase.from('players').insert([{
      event_id: eventId,
      employee_id: `COMP_${code}_${testSuffix}`,
      name,
      sport: 'Badminton',
      category,
      status: 'PLAYING',
      check_in_time: isCheckedIn ? new Date().toISOString() : null,
      previous_status: isCheckedIn ? 'PRESENT' : 'REGISTERED',
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

  // Test 1: Completing a Singles Match for Checked-in Players -> PRESENT
  await t.test('1. Checked-in singles players return to PRESENT after match completion (no QUALIFIED or DISQUALIFIED)', async () => {
    const anuj = await createPlayer('Anuj Sharma', 'ANUJ', true);
    const rohit = await createPlayer('Rohit Verma', 'ROHIT', true);

    const { data: match, error: mErr } = await supabase.from('matches').insert({
      event_id: eventId,
      sport: 'Badminton',
      category: 'Men Singles',
      phase: 'Round 1',
      playing_area: 'Court 1',
      scheduled_time: new Date('2026-09-02T10:00:00Z').toISOString(),
      team1_p1_id: anuj.id,
      team2_p1_id: rohit.id,
      status: 'LIVE'
    }).select().single();
    assert.ifError(mErr);
    createdMatchIds.push(match.id);

    // Admin completes match with Anuj winning
    const res = await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: match.id,
        winningTeam: 'team1',
        isWalkover: false
      })
    });
    const data = await res.json();
    assert.equal(res.status, 200, `API failed: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);
    assert.equal(data.match.status, 'COMPLETED');

    // Verify DB Match Status
    const { data: completedMatch } = await supabase.from('matches').select('status').eq('id', match.id).single();
    assert.equal(completedMatch.status, 'COMPLETED');

    // Verify Players Status returns to PRESENT
    const { data: anujAfter } = await supabase.from('players').select('status').eq('id', anuj.id).single();
    const { data: rohitAfter } = await supabase.from('players').select('status').eq('id', rohit.id).single();

    assert.equal(anujAfter.status, 'PRESENT', 'Checked-in winner must return to PRESENT (not QUALIFIED)');
    assert.equal(rohitAfter.status, 'PRESENT', 'Checked-in loser must return to PRESENT (not DISQUALIFIED)');
    assert.notEqual(anujAfter.status, 'QUALIFIED', 'Must not assign QUALIFIED');
    assert.notEqual(rohitAfter.status, 'DISQUALIFIED', 'Must not assign DISQUALIFIED');
  });

  // Test 2: Completing a Doubles Match for Checked-in Players -> PRESENT
  await t.test('2. Checked-in doubles players all return to PRESENT after match completion', async () => {
    const t1p1 = await createPlayer('Doubles P1', 'DP1', true, 'Men Doubles');
    const t1p2 = await createPlayer('Doubles P2', 'DP2', true, 'Men Doubles');
    const t2p1 = await createPlayer('Doubles P3', 'DP3', true, 'Men Doubles');
    const t2p2 = await createPlayer('Doubles P4', 'DP4', true, 'Men Doubles');

    const { data: match, error: mErr } = await supabase.from('matches').insert({
      event_id: eventId,
      sport: 'Badminton',
      category: 'Men Doubles',
      phase: 'Quarter Final',
      playing_area: 'Court 2',
      scheduled_time: new Date('2026-09-02T11:00:00Z').toISOString(),
      team1_p1_id: t1p1.id,
      team1_p2_id: t1p2.id,
      team2_p1_id: t2p1.id,
      team2_p2_id: t2p2.id,
      status: 'LIVE'
    }).select().single();
    assert.ifError(mErr);
    createdMatchIds.push(match.id);

    // Admin completes doubles match with Team 2 winning
    const res = await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: match.id,
        winningTeam: 'team2',
        isWalkover: false
      })
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.match.status, 'COMPLETED');

    // Verify all 4 players return to PRESENT
    const { data: all4 } = await supabase
      .from('players')
      .select('id, name, status')
      .in('id', [t1p1.id, t1p2.id, t2p1.id, t2p2.id]);

    assert.equal(all4.length, 4);
    for (const p of all4) {
      assert.equal(p.status, 'PRESENT', `${p.name} must return to PRESENT`);
      assert.ok(!p.status.includes('QUALIFIED'), `${p.name} must not be QUALIFIED`);
      assert.notEqual(p.status, 'DISQUALIFIED', `${p.name} must not be DISQUALIFIED`);
    }
  });

  // Test 3: Non-checked-in players preserve their existing attendance state
  await t.test('3. Non-checked-in players preserve existing attendance state (REGISTERED) without being incorrectly marked PRESENT', async () => {
    const unCheckedP1 = await createPlayer('Unchecked Player 1', 'UP1', false);
    const unCheckedP2 = await createPlayer('Unchecked Player 2', 'UP2', false);

    const { data: match } = await supabase.from('matches').insert({
      event_id: eventId,
      sport: 'Badminton',
      category: 'Men Singles',
      phase: 'Round 1',
      playing_area: 'Court 1',
      scheduled_time: new Date('2026-09-02T13:00:00Z').toISOString(),
      team1_p1_id: unCheckedP1.id,
      team2_p1_id: unCheckedP2.id,
      status: 'LIVE'
    }).select().single();
    createdMatchIds.push(match.id);

    await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: match.id, winningTeam: 'team1', isWalkover: false })
    });

    const { data: p1After } = await supabase.from('players').select('status').eq('id', unCheckedP1.id).single();
    const { data: p2After } = await supabase.from('players').select('status').eq('id', unCheckedP2.id).single();

    assert.equal(p1After.status, 'REGISTERED', 'Unchecked player must remain REGISTERED');
    assert.equal(p2After.status, 'REGISTERED', 'Unchecked player must remain REGISTERED');
  });

  // Test 4: Completed players remain selectable for subsequent matches across any phase
  await t.test('4. Completed players remain selectable for subsequent matches across any tournament phase', async () => {
    const pA = await createPlayer('Player Alpha', 'PA', true);
    const pB = await createPlayer('Player Beta', 'PB', true);

    // Initial match in Round 1
    const { data: match1 } = await supabase.from('matches').insert({
      event_id: eventId,
      sport: 'Badminton',
      category: 'Men Singles',
      phase: 'Round 1',
      playing_area: 'Court 1',
      scheduled_time: new Date('2026-09-02T12:00:00Z').toISOString(),
      team1_p1_id: pA.id,
      team2_p1_id: pB.id,
      status: 'LIVE'
    }).select().single();
    createdMatchIds.push(match1.id);

    // Complete Round 1 match
    await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: match1.id, winningTeam: 'team1', isWalkover: false })
    });

    // Verify players returned to PRESENT
    const { data: pAPresent } = await supabase.from('players').select('status').eq('id', pA.id).single();
    const { data: pBPresent } = await supabase.from('players').select('status').eq('id', pB.id).single();
    assert.equal(pAPresent.status, 'PRESENT');
    assert.equal(pBPresent.status, 'PRESENT');

    // Admin schedules Player Alpha for Round 2 / Semi Final at a later time
    const resRound2 = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Semi Final',
        playingArea: 'Court 1',
        scheduledTime: new Date('2026-09-02T15:00:00Z').toISOString(),
        team1_p1_id: pA.id,
        team2_p1_id: pB.id
      })
    });
    const r2Data = await resRound2.json();
    assert.equal(resRound2.status, 200, `Future match creation failed: ${JSON.stringify(r2Data)}`);
    assert.ok(r2Data.match?.id, 'Match creation for subsequent round must succeed');
    createdMatchIds.push(r2Data.match.id);
  });

  // Test 5: Walkover match scenario
  await t.test('5. Walkover match marks match WALKOVER, checked-in winner PRESENT, no-show NO_SHOW (no QUALIFIED or DISQUALIFIED)', async () => {
    const pPresent = await createPlayer('Present Winner', 'PW', true);
    const pNoShow = await createPlayer('NoShow Loser', 'NL', true);

    const { data: match } = await supabase.from('matches').insert({
      event_id: eventId,
      sport: 'Badminton',
      category: 'Men Singles',
      phase: 'Round 1',
      playing_area: 'Court 3',
      scheduled_time: new Date('2026-09-02T16:00:00Z').toISOString(),
      team1_p1_id: pPresent.id,
      team2_p1_id: pNoShow.id,
      status: 'LIVE'
    }).select().single();
    createdMatchIds.push(match.id);

    const res = await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: match.id,
        winningTeam: 'team1',
        isWalkover: true
      })
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.match.status, 'WALKOVER');

    const { data: pPresentAfter } = await supabase.from('players').select('status').eq('id', pPresent.id).single();
    const { data: pNoShowAfter } = await supabase.from('players').select('status').eq('id', pNoShow.id).single();

    assert.equal(pPresentAfter.status, 'PRESENT', 'Walkover checked-in winner is reset to PRESENT (not QUALIFIED)');
    assert.equal(pNoShowAfter.status, 'NO_SHOW', 'No-show loser is marked NO_SHOW (not DISQUALIFIED)');
    assert.notEqual(pPresentAfter.status, 'QUALIFIED');
    assert.notEqual(pNoShowAfter.status, 'DISQUALIFIED');
  });
});
