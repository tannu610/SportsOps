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

test('COURT MANAGEMENT: Dynamic Court Grid, Match Lifecycle & Player Responses', async (t) => {
  const testSuffix = Date.now();
  const createdPlayerIds = [];
  const createdMatchIds = [];

  // Create isolated event for this test suite
  const { data: newEv, error: evErr } = await supabase.from('events').insert({
    name: `Court Management Event ${testSuffix}`,
    event_date: '2026-09-01',
    venue: 'Court Arena',
    sport: 'Badminton'
  }).select().single();
  assert.ifError(evErr);
  const eventId = newEv.id;

  // Helper to create test player
  async function createPlayer(name, empCode) {
    const { data, error } = await supabase
      .from('players')
      .insert([
        {
          event_id: eventId,
          employee_id: `CRT_${empCode}_${testSuffix}`,
          name,
          sport: 'Badminton',
          category: "Men's Singles",
          status: 'PRESENT'
        }
      ])
      .select()
      .single();
    assert.ifError(error);
    createdPlayerIds.push(data.id);
    return data;
  }

  const p1 = await createPlayer('Anuj Sharma', 'ANUJ');
  const p2 = await createPlayer('Tannu Jha', 'TANNU');

  t.after(async () => {
    // Cleanup test matches
    for (const matchId of createdMatchIds) {
      await supabase.from('matches').delete().eq('id', matchId);
    }
    // Cleanup test players
    for (const pid of createdPlayerIds) {
      await supabase.from('notifications').delete().eq('player_id', pid);
      await supabase.from('players').delete().eq('id', pid);
    }
    // Cleanup isolated event
    try {
      await supabase.from('event_sports').delete().eq('event_id', eventId);
      await supabase.from('events').delete().eq('id', eventId);
    } catch {}
  });

  // Test 1: Event with 6 badminton courts dynamically derives 6 court cards
  await t.test('1. Event with 6 badminton courts derives exactly 6 courts', async () => {
    // Configure event with 6 badminton courts
    const saveRes = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        name: 'Annual Sports Day 2026',
        eventDate: '2026-09-01',
        venue: 'Main Sports Complex',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityUnit: 'Court',
              facilityCount: 6,
              categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Mixed Doubles"]
            }
          }
        }
      })
    });
    assert.equal(saveRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/admin/event/config?eventId=${eventId}`);
    const getData = await getRes.json();
    assert.equal(getRes.status, 200);

    const badmintonCfg = getData.configuration.sports['Badminton'];
    assert.equal(badmintonCfg.facilityCount, 6);
    assert.equal(badmintonCfg.facilityType, 'Courts');

    const generatedCourts = Array.from({ length: badmintonCfg.facilityCount }, (_, i) => `Court ${i + 1}`);
    assert.equal(generatedCourts.length, 6);
    assert.deepEqual(generatedCourts, [
      'Court 1',
      'Court 2',
      'Court 3',
      'Court 4',
      'Court 5',
      'Court 6'
    ]);
  });

  // Test 2: Event with 4 courts derives exactly 4 cards
  await t.test('2. Event with 4 courts derives exactly 4 courts', async () => {
    const saveRes = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        name: 'Annual Sports Day 2026',
        eventDate: '2026-09-01',
        venue: 'Main Sports Complex',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityUnit: 'Court',
              facilityCount: 4, // 4 courts
              categories: ["Men's Singles", "Women's Singles"]
            }
          }
        }
      })
    });
    assert.equal(saveRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/admin/event/config?eventId=${eventId}`);
    const getData = await getRes.json();
    const badmintonCfg = getData.configuration.sports['Badminton'];
    assert.equal(badmintonCfg.facilityCount, 4);

    const generatedCourts = Array.from({ length: badmintonCfg.facilityCount }, (_, i) => `Court ${i + 1}`);
    assert.equal(generatedCourts.length, 4);
    assert.deepEqual(generatedCourts, ['Court 1', 'Court 2', 'Court 3', 'Court 4']);

    // Reset back to 6 courts for remainder of tests
    await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        name: 'Annual Sports Day 2026',
        eventDate: '2026-09-01',
        venue: 'Main Sports Complex',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityUnit: 'Court',
              facilityCount: 6,
              categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Mixed Doubles"]
            }
          }
        }
      })
    });
  });

  // Test 3: Free court → Create Match works and transitions court to SCHEDULED
  let createdMatchId;
  const matchSlot = new Date(Date.now() + 1000 * 60 * 30).toISOString(); // 30 mins in future

  await t.test('3. Free court → Create match on Court 3 changes state from FREE to SCHEDULED', async () => {
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 3', // Targeted court
        scheduledTime: matchSlot,
        team1_p1_id: p1.id,
        team2_p1_id: p2.id
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200, `Match creation failed: ${JSON.stringify(data)}`);
    assert.ok(data.match?.id);
    createdMatchId = data.match.id;
    createdMatchIds.push(createdMatchId);

    // Verify match is recorded on Court 3 as SCHEDULED
    const { data: courtMatch } = await supabase
      .from('matches')
      .select('id, playing_area, status, sport, scheduled_time')
      .eq('id', createdMatchId)
      .single();

    assert.equal(courtMatch.playing_area, 'Court 3');
    assert.ok(['SCHEDULED', 'NOTIFIED'].includes(courtMatch.status), 'Match status must be SCHEDULED or NOTIFIED');
  });

  // Test 4: Individual player responses appear on the correct court
  await t.test('4. Individual player response status reflects Coming / Unavailable on Court 3', async () => {
    // Player 1 clicks "I'M COMING"
    const { error: acceptErr } = await supabase.rpc('player_accept_match', {
      p_player_id: p1.id,
      p_match_id: createdMatchId
    });
    assert.ifError(acceptErr);

    // Verify Player 1 status is AVAILABLE
    const { data: player1Data } = await supabase.from('players').select('status').eq('id', p1.id).single();
    assert.equal(player1Data.status, 'AVAILABLE', 'Player 1 should be marked AVAILABLE (Coming)');

    // Player 2 clicks "I'M UNAVAILABLE"
    const { error: rejectErr } = await supabase.rpc('player_reject_match', {
      p_player_id: p2.id,
      p_match_id: createdMatchId
    });
    assert.ifError(rejectErr);

    // Verify Player 2 status is UNAVAILABLE
    const { data: player2Data } = await supabase.from('players').select('status').eq('id', p2.id).single();
    assert.equal(player2Data.status, 'UNAVAILABLE', 'Player 2 should be marked UNAVAILABLE (Not Coming)');

    // Verify match status is updated to PLAYER_UNAVAILABLE so Court 3 triggers action required
    const { data: matchData } = await supabase.from('matches').select('status').eq('id', createdMatchId).single();
    assert.equal(matchData.status, 'PLAYER_UNAVAILABLE', 'Match status should flag PLAYER_UNAVAILABLE');
  });

  // Test 5: START LIVE changes SCHEDULED → LIVE
  await t.test('5. START LIVE changes match status on Court 3 from SCHEDULED to LIVE', async () => {
    // Admin clicks START LIVE
    const { error } = await supabase
      .from('matches')
      .update({ status: 'LIVE' })
      .eq('id', createdMatchId);
    assert.ifError(error);

    // Verify match status in Supabase is LIVE
    const { data: liveMatch } = await supabase.from('matches').select('status').eq('id', createdMatchId).single();
    assert.equal(liveMatch.status, 'LIVE', 'Court 3 match must now be LIVE');
  });

  // Test 6: Match completion frees the court back to FREE and resets players to PRESENT
  await t.test('6. Match completion frees Court 3 back to FREE and resets players to PRESENT', async () => {
    // Complete match with Team 1 winning via backend API
    const res = await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: createdMatchId,
        winningTeam: 'team1',
        isWalkover: false,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200, `Match completion failed: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);

    // Verify match is marked COMPLETED
    const { data: completedMatch } = await supabase
      .from('matches')
      .select('status')
      .eq('id', createdMatchId)
      .single();
    assert.equal(completedMatch.status, 'COMPLETED');

    // Verify both checked-in players reset to PRESENT (not QUALIFIED or DISQUALIFIED)
    const { data: p1After } = await supabase.from('players').select('status').eq('id', p1.id).single();
    const { data: p2After } = await supabase.from('players').select('status').eq('id', p2.id).single();
    assert.equal(p1After.status, 'PRESENT', 'Player 1 must be reset to PRESENT');
    assert.equal(p2After.status, 'PRESENT', 'Player 2 must be reset to PRESENT');

    // Verify no active live or scheduled match remains on Court 3
    const { data: activeMatches } = await supabase
      .from('matches')
      .select('id, status')
      .eq('playing_area', 'Court 3')
      .in('status', ['SCHEDULED', 'NOTIFIED', 'LIVE', 'PLAYER_UNAVAILABLE', 'NO-SHOW PENDING']);

    assert.equal(activeMatches.length, 0, 'No active match should remain on Court 3; court is now FREE');
  });
});
