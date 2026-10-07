import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { extractPlayerCode, extractPlayerSource, isValidPlayerCode } from '../src/utils/playerCode.ts';

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

test('BUG FIX VERIFICATION: Walk-in player registration source tracking and persistence', async (t) => {
  const testSuffix = Date.now();
  const createdPlayerIds = [];
  const createdMatchIds = [];
  let eventId = null;

  // Setup isolated event for testing
  const { data: newEv, error: evErr } = await supabase.from('events').insert({
    name: `Source Tracking Test Event ${testSuffix}`,
    event_date: '2026-10-08',
    venue: 'Arena Source Tracking',
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

  let walkInPlayerId = null;
  let walkInPlayerCode = null;
  let walkInCheckInToken = null;

  // TEST 1: Create a new player through /player/register -> source = WALK-IN
  await t.test('TEST 1: Create a new player through /player/register -> DB record source = WALK-IN, Admin UI source = WALK-IN', async () => {
    const empId = `EMP_WALKIN_${testSuffix}`;
    const res = await fetch(`${baseUrl}/api/player/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        employee_id: empId,
        name: `WalkIn Player ${testSuffix}`,
        gender: 'Female',
        contact_info: '9876543210',
        sport: 'Badminton',
        categories: ["Women's Singles"],
        email: 'walkin@example.com'
      })
    });

    assert.strictEqual(res.status, 201, 'Registration should return 201');
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.player.source, 'WALK-IN', 'API response source must be WALK-IN');
    assert.strictEqual(data.player.status, 'REGISTERED', 'Initial status must be REGISTERED');

    walkInPlayerId = data.player.id;
    walkInPlayerCode = data.player.player_code;
    walkInCheckInToken = data.check_in_token;
    createdPlayerIds.push(walkInPlayerId);

    // Verify DB record directly
    const { data: dbPlayer } = await supabase.from('players').select('*').eq('id', walkInPlayerId).single();
    const dbSource = extractPlayerSource(dbPlayer);
    assert.strictEqual(dbSource, 'WALK-IN', 'Database record source must be WALK-IN');

    // Verify Admin UI extraction
    const adminUiSource = extractPlayerSource(dbPlayer);
    assert.strictEqual(adminUiSource, 'WALK-IN', 'Admin UI source display must be WALK-IN');
  });

  // TEST 2: Import a new player through Admin import -> source = IMPORT
  let importedPlayerId = null;
  await t.test('TEST 2: Import a new player through Admin import -> DB record source = IMPORT, Admin UI source = IMPORT', async () => {
    const empId = `EMP_IMPORT_${testSuffix}`;
    const res = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        records: [
          {
            empId,
            name: `Imported Player ${testSuffix}`,
            sport: 'Badminton',
            category: "Women's Singles",
            gender: 'Female',
            contact: '9876543211'
          }
        ]
      })
    });

    assert.strictEqual(res.status, 200, 'Import should return 200');
    const data = await res.json();
    assert.strictEqual(data.success, true);

    const { data: dbPlayers } = await supabase.from('players').select('*').eq('employee_id', empId);
    assert.ok(dbPlayers && dbPlayers.length === 1);
    const impPlayer = dbPlayers[0];
    importedPlayerId = impPlayer.id;
    createdPlayerIds.push(importedPlayerId);

    const dbSource = extractPlayerSource(impPlayer);
    assert.strictEqual(dbSource, 'IMPORT', 'Imported player database source must be IMPORT');

    const adminUiSource = extractPlayerSource(impPlayer);
    assert.strictEqual(adminUiSource, 'IMPORT', 'Admin UI source display must be IMPORT');
  });

  // TEST 3: Create a walk-in player and verify the Player Code
  await t.test('TEST 3: Walk-in player has valid Player Code and source = WALK-IN', () => {
    assert.ok(walkInPlayerCode, 'Player Code must be present');
    assert.ok(isValidPlayerCode(walkInPlayerCode), `Player Code ${walkInPlayerCode} must match SO-XXXXXX`);
  });

  // TEST 4: Check in the walk-in player -> source remains WALK-IN, status changes normally
  await t.test('TEST 4: Check in the walk-in player -> source remains WALK-IN, status changes to PRESENT', async () => {
    const res = await fetch(`${baseUrl}/api/player/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: walkInPlayerId,
        token: walkInCheckInToken
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.player.status, 'PRESENT', 'Status should change to PRESENT');

    const { data: dbPlayer } = await supabase.from('players').select('*').eq('id', walkInPlayerId).single();
    assert.strictEqual(dbPlayer.status, 'PRESENT');
    assert.strictEqual(extractPlayerSource(dbPlayer), 'WALK-IN', 'Source must remain WALK-IN after check-in');
    assert.strictEqual(extractPlayerCode(dbPlayer), walkInPlayerCode, 'Player Code must remain unchanged');
  });

  // TEST 5: Assign the walk-in player to a match -> source remains WALK-IN
  await t.test('TEST 5: Assign walk-in player to a match -> source remains WALK-IN', async () => {
    // Check in imported player as opponent
    await supabase.from('players').update({ status: 'PRESENT' }).eq('id', importedPlayerId);

    const matchTime = new Date(Date.now() + 3600000).toISOString();
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Women's Singles",
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime: matchTime,
        team1_p1_id: walkInPlayerId,
        team2_p1_id: importedPlayerId
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    createdMatchIds.push(data.match.id);

    const { data: dbPlayer } = await supabase.from('players').select('*').eq('id', walkInPlayerId).single();
    assert.strictEqual(dbPlayer.status, 'CALLED', 'Status should change to CALLED');
    assert.strictEqual(extractPlayerSource(dbPlayer), 'WALK-IN', 'Source must remain WALK-IN after match assignment');
  });

  // TEST 6: Open Player Dashboard & Subscribe to Push -> Player Code, Identity, and Source remain unchanged
  await t.test('TEST 6: Simulate push notification subscription -> Player Code, Identity, and Source remain WALK-IN', async () => {
    // Simulate push subscription call from Player Dashboard
    const fakeSubscription = {
      endpoint: `https://fcm.googleapis.com/fcm/send/test-${testSuffix}`,
      keys: {
        p256dh: 'test-p256dh-key',
        auth: 'test-auth-key'
      }
    };

    const res = await fetch(`${baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: walkInPlayerId,
        subscription: fakeSubscription
      })
    });

    assert.strictEqual(res.status, 200);

    const { data: dbPlayer } = await supabase.from('players').select('*').eq('id', walkInPlayerId).single();
    assert.strictEqual(extractPlayerCode(dbPlayer), walkInPlayerCode, 'Player Code must be strictly preserved');
    assert.strictEqual(extractPlayerSource(dbPlayer), 'WALK-IN', 'Source must remain WALK-IN even after push subscription');
    assert.strictEqual(dbPlayer.push_subscription?.endpoint, fakeSubscription.endpoint, 'Push endpoint must be saved');
  });

  // TEST 7: Verify existing imported players -> source remains IMPORT
  await t.test('TEST 7: Verify existing imported players retain source = IMPORT', async () => {
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('*')
      .eq('created_at', '2026-10-06T22:03:20.215627+00:00');

    assert.ok(dbPlayers && dbPlayers.length === 15, '15 initial imported players should exist');
    for (const p of dbPlayers) {
      assert.strictEqual(extractPlayerSource(p), 'IMPORT', `Player ${p.name} source must be IMPORT`);
    }
  });

  // TEST 8: Verify Priyanka existing record is preserved as WALK-IN
  await t.test('TEST 8: Verify Priyanka existing record has source = WALK-IN and unchanged code SO-UA8SMF', async () => {
    const { data: priyankaList } = await supabase
      .from('players')
      .select('*')
      .eq('employee_id', '124328');

    assert.ok(priyankaList && priyankaList.length === 1);
    const priyanka = priyankaList[0];

    assert.strictEqual(priyanka.name, 'Priyanka');
    assert.strictEqual(extractPlayerCode(priyanka), 'SO-UA8SMF', 'Priyanka Player Code must remain SO-UA8SMF');
    assert.strictEqual(extractPlayerSource(priyanka), 'WALK-IN', 'Priyanka source must be WALK-IN');
    assert.strictEqual(priyanka.status, 'PRESENT', 'Priyanka status must remain PRESENT');
  });
});
