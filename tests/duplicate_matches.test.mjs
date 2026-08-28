import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length > 0) {
        let val = rest.join('=').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key.trim()] = val;
      }
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';

const supabase = createClient(supabaseUrl, supabaseKey);

test('BUG-006: Player schedule conflicts & duplicate match prevention', async (t) => {
  // 1. Setup test fixture
  const { data: events } = await supabase.from('events').select('id').limit(1);
  assert.ok(events && events.length > 0, 'An event must exist');
  const eventId = events[0].id;

  const testSuffix = Date.now();
  const createdPlayerIds = [];
  const createdMatchIds = [];

  // Helper to create test player
  async function createPlayer(name, empCode) {
    const { data, error } = await supabase.from('players').insert([{
      event_id: eventId,
      employee_id: `EMP_${empCode}_${testSuffix}`,
      name,
      sport: 'Badminton',
      category: 'Men Singles',
      status: 'PRESENT'
    }]).select().single();
    assert.ifError(error);
    createdPlayerIds.push(data.id);
    return data;
  }

  const pRohit = await createPlayer('Rohit Sharma', 'ROHIT');
  const pAnuj = await createPlayer('Anuj Kumar', 'ANUJ');
  const pVirat = await createPlayer('Virat Kohli', 'VIRAT');
  const pRahul = await createPlayer('KL Rahul', 'RAHUL');
  const pShubman = await createPlayer('Shubman Gill', 'SHUBMAN');
  const pHardik = await createPlayer('Hardik Pandya', 'HARDIK');

  t.after(async () => {
    // Cleanup test matches
    for (const matchId of createdMatchIds) {
      await supabase.from('matches').delete().eq('id', matchId);
    }
    // Cleanup test players
    for (const pid of createdPlayerIds) {
      await supabase.from('players').delete().eq('id', pid);
    }
  });

  const slot330AM = new Date('2026-08-29T03:30:00.000Z').toISOString();
  const slot430AM = new Date('2026-08-29T04:30:00.000Z').toISOString();

  // Test 1: Create initial base match (Rohit vs Anuj — Court 1 — 3:30 AM)
  await t.test('Create base match: Rohit vs Anuj — Court 1 — 3:30 AM', async () => {
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime: slot330AM,
        team1_p1_id: pRohit.id,
        team2_p1_id: pAnuj.id,
      })
    });
    const data = await res.json();
    assert.equal(res.status, 200, `Base match creation failed: ${JSON.stringify(data)}`);
    assert.ok(data.match?.id);
    createdMatchIds.push(data.match.id);
  });

  // Test 2: Same player + same time + different court → rejected
  await t.test('Same player + same time + different court → rejected', async () => {
    // Rohit vs Virat — Court 2 — 3:30 AM (Rohit is already in match at 3:30 AM)
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 1',
        playingArea: 'Court 2', // Different court!
        scheduledTime: slot330AM, // Same time!
        team1_p1_id: pRohit.id, // Conflicting player!
        team2_p1_id: pVirat.id,
      })
    });
    const data = await res.json();
    assert.equal(res.status, 409, 'Must return 409 Conflict');
    assert.equal(
      data.error,
      'Player conflict: one or more players already have a match scheduled at this time.'
    );
  });

  // Test 3: Same players in reverse order + same time → rejected
  await t.test('Same players in reverse order + same time → rejected', async () => {
    // Anuj vs Rohit — Court 2 — 3:30 AM
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 1',
        playingArea: 'Court 2', // Different court
        scheduledTime: slot330AM, // Same time
        team1_p1_id: pAnuj.id, // Swapped
        team2_p1_id: pRohit.id, // Swapped
      })
    });
    const data = await res.json();
    assert.equal(res.status, 409, 'Must return 409 Conflict');
    assert.equal(
      data.error,
      'Player conflict: one or more players already have a match scheduled at this time.'
    );
  });

  // Test 4: Same player in two different doubles matches at same time → rejected
  await t.test('Same player in two different doubles matches at same time → rejected', async () => {
    // Create first doubles match at 4:30 AM: [Virat, Rahul] vs [Shubman, Hardik] — Court 1
    const res1 = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Doubles',
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime: slot430AM,
        team1_p1_id: pVirat.id,
        team1_p2_id: pRahul.id,
        team2_p1_id: pShubman.id,
        team2_p2_id: pHardik.id,
      })
    });
    const data1 = await res1.json();
    assert.equal(res1.status, 200, `First doubles match creation failed: ${JSON.stringify(data1)}`);
    createdMatchIds.push(data1.match.id);

    // Attempt second doubles match at 4:30 AM with Virat on Court 2: [Virat, Rohit] vs [Anuj, Hardik]
    const res2 = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Doubles',
        phase: 'Round 1',
        playingArea: 'Court 2',
        scheduledTime: slot430AM,
        team1_p1_id: pVirat.id, // Conflicting player!
        team1_p2_id: pRohit.id,
        team2_p1_id: pAnuj.id,
        team2_p2_id: pHardik.id, // Another conflicting player!
      })
    });
    const data2 = await res2.json();
    assert.equal(res2.status, 409, 'Must return 409 Conflict');
    assert.equal(
      data2.error,
      'Player conflict: one or more players already have a match scheduled at this time.'
    );
  });

  // Test 5: Same players at different time → allowed
  await t.test('Same players at different time → allowed', async () => {
    const slot530AM = new Date('2026-08-29T05:30:00.000Z').toISOString();
    // Rohit vs Anuj — Court 1 — 5:30 AM (Same players, but different time!)
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 2',
        playingArea: 'Court 1',
        scheduledTime: slot530AM,
        team1_p1_id: pRohit.id,
        team2_p1_id: pAnuj.id,
      })
    });
    const data = await res.json();
    assert.equal(res.status, 200, `Same players at different time must be allowed: ${JSON.stringify(data)}`);
    assert.ok(data.match?.id);
    createdMatchIds.push(data.match.id);
  });

  // Test 6: Different players at same time → allowed (on different court)
  await t.test('Different players at same time → allowed', async () => {
    // Virat vs Rahul — Court 2 — 3:30 AM (different players, different court, same 3:30 AM time)
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Round 1',
        playingArea: 'Court 2',
        scheduledTime: slot330AM,
        team1_p1_id: pVirat.id,
        team2_p1_id: pRahul.id,
      })
    });
    const data = await res.json();
    assert.equal(res.status, 200, `Different players at same time must be allowed: ${JSON.stringify(data)}`);
    assert.ok(data.match?.id);
    createdMatchIds.push(data.match.id);
  });

  // Test 7: Match cards show sport, category, round, court, players, time, and status
  await t.test('Match data model contains sport, category, round, court, players, time, and status', async () => {
    const { data: fetchedMatch, error } = await supabase
      .from('matches')
      .select(`
        id, sport, category, phase, playing_area, scheduled_time, status,
        team1_p1:players!fk_t1p1(id, name),
        team1_p2:players!fk_t1p2(id, name),
        team2_p1:players!fk_t2p1(id, name),
        team2_p2:players!fk_t2p2(id, name)
      `)
      .eq('id', createdMatchIds[0])
      .single();

    assert.ifError(error);
    assert.equal(fetchedMatch.sport, 'Badminton', 'Must have sport');
    assert.equal(fetchedMatch.category, 'Men Singles', 'Must have category');
    assert.equal(fetchedMatch.phase, 'Round 1', 'Must have phase/round');
    assert.equal(fetchedMatch.playing_area, 'Court 1', 'Must have court/playing area');
    assert.ok(fetchedMatch.scheduled_time, 'Must have scheduled match time');
    assert.ok(fetchedMatch.status, 'Must have match status');
    assert.equal(fetchedMatch.team1_p1?.name, 'Rohit Sharma', 'Must have Team 1 Player 1');
    assert.equal(fetchedMatch.team2_p1?.name, 'Anuj Kumar', 'Must have Team 2 Player 1');
  });

  // Test 8: Concurrent requests with same player at same time across different courts → only one succeeds
  await t.test('Concurrent requests for same player across different courts allow at most one insertion', async () => {
    const slot630AM = new Date('2026-08-29T06:30:00.000Z').toISOString();

    const requests = [
      // Request 1: Rohit vs Anuj — Court 1
      fetch(`${baseUrl}/api/matches/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          sport: 'Badminton',
          category: 'Men Singles',
          phase: 'Round 1',
          playingArea: 'Court 1',
          scheduledTime: slot630AM,
          team1_p1_id: pRohit.id,
          team2_p1_id: pAnuj.id,
        })
      }),
      // Request 2: Anuj vs Rohit — Court 2
      fetch(`${baseUrl}/api/matches/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          sport: 'Badminton',
          category: 'Men Singles',
          phase: 'Round 1',
          playingArea: 'Court 2',
          scheduledTime: slot630AM,
          team1_p1_id: pAnuj.id,
          team2_p1_id: pRohit.id,
        })
      }),
      // Request 3: Rohit vs Virat — Court 3
      fetch(`${baseUrl}/api/matches/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          sport: 'Badminton',
          category: 'Men Singles',
          phase: 'Round 1',
          playingArea: 'Court 3',
          scheduledTime: slot630AM,
          team1_p1_id: pRohit.id,
          team2_p1_id: pVirat.id,
        })
      })
    ];

    const responses = await Promise.all(requests);
    const results = await Promise.all(responses.map(r => r.json().then(b => ({ status: r.status, body: b }))));

    const successes = results.filter(r => r.status === 200);
    const conflicts = results.filter(r => r.status === 409);

    assert.equal(successes.length, 1, `Exactly 1 concurrent request must succeed. Got: ${successes.length}`);
    assert.equal(conflicts.length, 2, `All other concurrent requests must return 409 Conflict. Got: ${conflicts.length}`);
    conflicts.forEach(c => {
      assert.ok(
        c.body.error === 'Player conflict: one or more players already have a match scheduled at this time.' ||
        c.body.error === 'This match already exists.'
      );
    });
    createdMatchIds.push(successes[0].body.match.id);
  });
});
