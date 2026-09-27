import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { isValidPlayerCode, extractPlayerCode } from '../src/utils/playerCode.ts';

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

test('PLAYER CODE FOR ALL REGISTERED PLAYERS - Acceptance Test Suite', async (t) => {
  const testSuffix = Date.now();
  const createdPlayerIds = [];
  const createdMatchIds = [];
  let eventId = null;

  // Setup isolated event for testing
  const { data: newEv, error: evErr } = await supabase.from('events').insert({
    name: `Player Code Test Event ${testSuffix}`,
    event_date: '2026-09-28',
    venue: 'Arena Player Code',
    sport: 'Badminton',
    configuration: {
      sports: {
        Badminton: {
          enabled: true,
          facilityType: 'Courts',
          facilityUnit: 'Court',
          facilityCount: 4,
          categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"]
        }
      }
    }
  }).select().single();
  assert.ifError(evErr);
  eventId = newEv.id;

  // Cleanup handler
  t.after(async () => {
    for (const mid of createdMatchIds) {
      try { await supabase.from('matches').delete().eq('id', mid); } catch {}
    }
    for (const pid of createdPlayerIds) {
      try { await supabase.from('players').delete().eq('id', pid); } catch {}
    }
    if (eventId) {
      try { await supabase.from('events').delete().eq('id', eventId); } catch {}
    }
  });

  let importedPlayerCodes = [];
  let importedRecords = [];

  await t.test('TEST 1 & 2: Import new players -> unique SO-XXXXXX generated, source=IMPORT, status=REGISTERED', async () => {
    importedRecords = [
      {
        empId: `IMP1_${testSuffix}`,
        name: `Tanya Import ${testSuffix}`,
        sport: 'Badminton',
        category: "Women's Singles",
        gender: 'Female',
        contact: '9876543210'
      },
      {
        empId: `IMP2_${testSuffix}`,
        name: `Parul Import ${testSuffix}`,
        sport: 'Badminton',
        category: "Women's Singles",
        gender: 'Female',
        contact: '9876543211'
      },
      {
        empId: `IMP3_${testSuffix}`,
        name: `Karan Singh ${testSuffix}`,
        sport: 'Badminton',
        category: "Men's Singles",
        gender: 'Male',
        contact: '9876543212'
      }
    ];

    const res = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        records: importedRecords
      })
    });

    assert.equal(res.status, 200, 'Import endpoint should return 200');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.insertedCount, 3, 'All 3 records should be inserted');

    // Fetch from database to verify persistence
    const { data: dbPlayers, error: fetchErr } = await supabase
      .from('players')
      .select('id, employee_id, name, sport, category, status, push_subscription')
      .eq('event_id', eventId);
    assert.ifError(fetchErr);

    const testPlayers = dbPlayers.filter(p => p.employee_id.includes(String(testSuffix)));
    assert.equal(testPlayers.length, 3);

    testPlayers.forEach(p => {
      createdPlayerIds.push(p.id);
      const code = extractPlayerCode(p);
      assert.ok(code, `Player ${p.name} must have a persistent Player Code`);
      assert.ok(isValidPlayerCode(code), `Player code ${code} must match SO-XXXXXX format`);
      assert.equal(p.status, 'REGISTERED', 'Imported player status must be REGISTERED');
      
      const metaSource = p.push_subscription?._metadata?.source;
      assert.ok(metaSource === 'IMPORT' || !metaSource, 'Metadata source should be IMPORT');
    });

    importedPlayerCodes = testPlayers.map(p => extractPlayerCode(p));
    // Test 2: Uniqueness
    const uniqueSet = new Set(importedPlayerCodes);
    assert.equal(uniqueSet.size, 3, 'All 3 player codes must be globally unique');
  });

  await t.test('TEST 3: Re-import existing player -> preserves existing Player Code, no duplicate player', async () => {
    const res = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        records: importedRecords // same 3 players
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.insertedCount, 0, 'No duplicates should be inserted on re-import');

    // Verify existing players still retain their exact original codes
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, employee_id, name, sport, category, status, push_subscription')
      .eq('event_id', eventId);

    const testPlayers = dbPlayers.filter(p => p.employee_id.includes(String(testSuffix)));
    assert.equal(testPlayers.length, 3, 'Total player count must remain 3');

    testPlayers.forEach(p => {
      const code = extractPlayerCode(p);
      assert.ok(importedPlayerCodes.includes(code), `Player ${p.name} must retain original code ${code}`);
    });
  });

  let legacyPlayerId = null;
  await t.test('TEST 4: Backfill existing players with missing Player Codes', async () => {
    // Manually insert a legacy player without a player_code
    const legacyEmpId = `LEGACY_${testSuffix}`;
    const { data: legacyPlayer, error: legErr } = await supabase.from('players').insert({
      event_id: eventId,
      employee_id: legacyEmpId,
      name: `Legacy Player ${testSuffix}`,
      sport: 'Badminton',
      category: "Men's Singles",
      status: 'PRESENT',
      check_in_time: new Date().toISOString(),
      push_subscription: { _metadata: { source: 'IMPORT' } }
    }).select().single();
    assert.ifError(legErr);
    legacyPlayerId = legacyPlayer.id;
    createdPlayerIds.push(legacyPlayerId);

    // Verify initially has no code
    assert.equal(extractPlayerCode(legacyPlayer), null);

    // Call backfill API
    const bfRes = await fetch(`${baseUrl}/api/admin/players/backfill`, {
      method: 'POST'
    });
    assert.equal(bfRes.status, 200);
    const bfData = await bfRes.json();
    assert.equal(bfData.success, true);
    assert.ok(bfData.updatedCount >= 1, 'Should have updated at least our legacy player');

    // Verify legacy player now has a code, while preserving status and check_in_time
    const { data: refetchedLegacy } = await supabase
      .from('players')
      .select('id, employee_id, name, sport, category, status, check_in_time, push_subscription')
      .eq('id', legacyPlayerId)
      .single();

    const assignedCode = extractPlayerCode(refetchedLegacy);
    assert.ok(assignedCode, 'Legacy player must now have a Player Code');
    assert.ok(isValidPlayerCode(assignedCode), `Assigned code ${assignedCode} must match SO-XXXXXX`);
    assert.equal(refetchedLegacy.status, 'PRESENT', 'Status must remain PRESENT');
    assert.equal(refetchedLegacy.check_in_time, legacyPlayer.check_in_time, 'Check-in time must be preserved');
  });

  await t.test('TEST 5: Idempotent backfill -> second run leaves codes unchanged', async () => {
    // Record current codes
    const { data: playersBefore } = await supabase
      .from('players')
      .select('id, push_subscription');
    
    const codesBefore = new Map();
    playersBefore.forEach(p => {
      codesBefore.set(p.id, extractPlayerCode(p));
    });

    // Run backfill again
    const bfRes2 = await fetch(`${baseUrl}/api/admin/players/backfill`, {
      method: 'POST'
    });
    assert.equal(bfRes2.status, 200);
    const bfData2 = await bfRes2.json();
    assert.equal(bfData2.updatedCount, 0, 'No players should be updated on second run');

    // Verify all codes identical
    const { data: playersAfter } = await supabase
      .from('players')
      .select('id, push_subscription');
    
    playersAfter.forEach(p => {
      const codeAfter = extractPlayerCode(p);
      const codeBefore = codesBefore.get(p.id);
      assert.equal(codeAfter, codeBefore, `Player ${p.id} code should not have changed`);
    });
  });

  let walkInPlayer = null;
  await t.test('TEST 6: Walk-in player compatibility -> receives same SO-XXXXXX format & source=WALK-IN', async () => {
    const walkInRes = await fetch(`${baseUrl}/api/player/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: `WALK_${testSuffix}`,
        name: `Tanvi WalkIn ${testSuffix}`,
        gender: 'Female',
        contact_info: '9876543299',
        sport: 'Badminton',
        categories: ["Women's Singles"],
        event_id: eventId
      })
    });

    assert.equal(walkInRes.status, 201, 'Walk-in registration should succeed');
    const data = await walkInRes.json();
    assert.equal(data.success, true);
    assert.ok(data.player.player_code, 'Walk-in player must receive player_code');
    assert.ok(isValidPlayerCode(data.player.player_code), 'Player code format must be SO-XXXXXX');
    assert.equal(data.player.source, 'WALK-IN', 'Player source must be WALK-IN');

    walkInPlayer = data.player;
    createdPlayerIds.push(walkInPlayer.id);
  });

  await t.test('TEST 7: Check-in API & Player Identity with Player Code', async () => {
    // Check in the imported player
    const imp1 = importedRecords[0];
    const { data: imp1Player } = await supabase
      .from('players')
      .select('id, employee_id, name, sport, push_subscription')
      .eq('employee_id', imp1.empId)
      .single();

    const checkInRes = await fetch(`${baseUrl}/api/player/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: imp1Player.id,
        employee_id: imp1Player.employee_id,
        mobile_no: imp1.contact
      })
    });

    assert.equal(checkInRes.status, 200);
    const ciData = await checkInRes.json();
    assert.equal(ciData.success, true);
    assert.equal(ciData.player.status, 'PRESENT');
    assert.ok(isValidPlayerCode(ciData.player.player_code), 'Check-in must return valid SO-XXXXXX code');
  });

  await t.test('TEST 8: Match Lifecycle with 1 Imported player and 1 Walk-in player', async () => {
    // 1. Ensure walkInPlayer is checked in
    const { data: walkInDb } = await supabase
      .from('players')
      .select('id, status')
      .eq('id', walkInPlayer.id)
      .single();

    if (walkInDb.status !== 'PRESENT') {
      await supabase.from('players').update({ status: 'PRESENT' }).eq('id', walkInPlayer.id);
    }

    const { data: impPlayerDb } = await supabase
      .from('players')
      .select('id, status')
      .eq('employee_id', importedRecords[0].empId)
      .single();

    assert.equal(impPlayerDb.status, 'PRESENT', 'Import player must be PRESENT');

    // 2. Committee schedules match
    const { data: match, error: matchErr } = await supabase.from('matches').insert({
      event_id: eventId,
      sport: 'Badminton',
      category: "Women's Singles",
      playing_area: 'Court 1',
      scheduled_time: new Date().toISOString(),
      team1_p1_id: impPlayerDb.id,
      team2_p1_id: walkInPlayer.id,
      status: 'SCHEDULED'
    }).select().single();
    assert.ifError(matchErr);
    createdMatchIds.push(match.id);

    // 3. Move match to NOTIFIED -> players become CALLED
    await supabase.from('matches').update({ status: 'NOTIFIED' }).eq('id', match.id);
    await supabase.from('players').update({ status: 'CALLED' }).in('id', [impPlayerDb.id, walkInPlayer.id]);

    const { data: calledPlayers } = await supabase.from('players').select('status').in('id', [impPlayerDb.id, walkInPlayer.id]);
    assert.ok(calledPlayers.every(p => p.status === 'CALLED'), 'Both players must be CALLED');

    // 4. Move match to LIVE -> players become PLAYING
    await supabase.from('matches').update({ status: 'LIVE' }).eq('id', match.id);
    await supabase.from('players').update({ status: 'PLAYING' }).in('id', [impPlayerDb.id, walkInPlayer.id]);

    const { data: playingPlayers } = await supabase.from('players').select('status').in('id', [impPlayerDb.id, walkInPlayer.id]);
    assert.ok(playingPlayers.every(p => p.status === 'PLAYING'), 'Both players must be PLAYING');

    // 5. Complete match -> match COMPLETED, players return to PRESENT
    await supabase.from('matches').update({ status: 'COMPLETED' }).eq('id', match.id);
    await supabase.from('players').update({ status: 'PRESENT' }).in('id', [impPlayerDb.id, walkInPlayer.id]);

    const { data: completedPlayers } = await supabase.from('players').select('status').in('id', [impPlayerDb.id, walkInPlayer.id]);
    assert.ok(completedPlayers.every(p => p.status === 'PRESENT'), 'Both players must return to PRESENT');
  });
});
