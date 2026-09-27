import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { isCategoryApplicableToGender } from '../src/utils/eventConfig.ts';
import { generateCheckInToken, verifyCheckInToken } from '../src/utils/checkInToken.ts';

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

test('IMPROVEMENT-001: Match-Day Real-Time Player Self-Registration & Automatic Check-In', async (t) => {
  const testSuffix = Date.now();
  const createdPlayerIds = [];
  const createdMatchIds = [];
  const createdEventIds = [];

  // Setup isolated event for testing with Badminton and Table Tennis
  const { data: newEv, error: evErr } = await supabase.from('events').insert({
    name: `Self-Reg MatchDay Event ${testSuffix}`,
    event_date: '2026-09-28',
    venue: 'Arena 1',
    sport: 'Badminton',
    configuration: {
      sports: {
        Badminton: {
          enabled: true,
          facilityType: 'Courts',
          facilityUnit: 'Court',
          facilityCount: 4,
          categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"]
        },
        'Table Tennis': {
          enabled: true,
          facilityType: 'Tables',
          facilityUnit: 'Table',
          facilityCount: 2,
          categories: ["Men's Singles", "Women's Singles", "Open Doubles"]
        }
      }
    }
  }).select().single();
  assert.ifError(evErr);
  const eventId = newEv.id;
  createdEventIds.push(eventId);

  // Setup relational event tables
  try {
    const { data: spBadminton } = await supabase.from('event_sports').insert({
      event_id: eventId,
      sport: 'Badminton'
    }).select().single();
    if (spBadminton) {
      await supabase.from('event_facilities').insert({
        event_sport_id: spBadminton.id,
        facility_type: 'Courts',
        facility_count: 4
      });
      await supabase.from('event_categories').insert([
        { event_sport_id: spBadminton.id, category: "Men's Singles" },
        { event_sport_id: spBadminton.id, category: "Women's Singles" },
        { event_sport_id: spBadminton.id, category: "Men's Doubles" },
        { event_sport_id: spBadminton.id, category: "Women's Doubles" },
        { event_sport_id: spBadminton.id, category: "Mixed Doubles" }
      ]);
    }
  } catch {}

  // Cleanup handler
  t.after(async () => {
    for (const mid of createdMatchIds) {
      try { await supabase.from('matches').delete().eq('id', mid); } catch {}
    }
    for (const pid of createdPlayerIds) {
      try { await supabase.from('players').delete().eq('id', pid); } catch {}
    }
    for (const eid of createdEventIds) {
      try {
        await supabase.from('event_sports').delete().eq('event_id', eid);
        await supabase.from('events').delete().eq('id', eid);
      } catch {}
    }
  });

  // TEST 1: Entry Point on Check-In Page
  await t.test('TEST 1: Player Check-In page contains link to Register New Player', () => {
    const checkInPagePath = path.resolve(process.cwd(), 'src/app/player/check-in/page.tsx');
    assert.ok(fs.existsSync(checkInPagePath), 'check-in/page.tsx must exist');
    const content = fs.readFileSync(checkInPagePath, 'utf8');
    assert.ok(content.includes('Not registered? Register New Player'), 'Must include link text');
    assert.ok(content.includes('/player/register'), 'Must link to /player/register');
  });

  // TEST 2: Registration Form UI structure and fields
  await t.test('TEST 2: Match-Day Registration page contains required fields, Male/Female only, and NO Transport', () => {
    const regPagePath = path.resolve(process.cwd(), 'src/app/player/register/page.tsx');
    assert.ok(fs.existsSync(regPagePath), 'register/page.tsx must exist');
    const content = fs.readFileSync(regPagePath, 'utf8');

    assert.ok(content.includes('MATCH-DAY REGISTRATION'), 'Heading must be MATCH-DAY REGISTRATION');
    assert.ok(content.includes("Not registered yet? Register for today"), 'Subtitle must match');
    assert.ok(content.includes('Employee ID'), 'Must have Employee ID');
    assert.ok(content.includes('Full Name'), 'Must have Full Name');
    assert.ok(content.includes('Gender'), 'Must have Gender');
    assert.ok(content.includes('Sport'), 'Must have Sport');
    assert.ok(content.includes('Category'), 'Must have Category');
    assert.ok(content.includes('Mobile / Contact Number'), 'Must have Mobile / Contact Number');
    assert.ok(content.includes('Email ID'), 'Must have Email ID');

    // Verify Gender is ONLY Male and Female
    assert.ok(content.includes('"Male"') && content.includes('"Female"'));
    assert.ok(!content.includes('"Prefer not to say"'), 'Prefer not to say must be removed');
    assert.ok(!content.includes('"Other"'), 'Other gender option must be removed');

    // Verify Transport is completely removed
    assert.ok(!content.includes('Transport Required?'), 'Transport Required? must be completely removed');

    // Verify updated success copy for auto-checkin
    assert.ok(
      content.includes("Your registration is complete. Continue below to check in for today"),
      'Must contain updated success check-in prompt'
    );
  });

  // TEST 3: Gender-based Category Filtering (Case 1 & Case 2)
  await t.test('TEST 3: Filter categories strictly by Gender and configured event sports', () => {
    const badmintonAll = ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"];
    
    const maleCase1 = badmintonAll.filter(c => isCategoryApplicableToGender(c, 'Male'));
    assert.deepStrictEqual(maleCase1, ["Men's Singles", "Men's Doubles", "Mixed Doubles"]);

    const femaleCase1 = badmintonAll.filter(c => isCategoryApplicableToGender(c, 'Female'));
    assert.deepStrictEqual(femaleCase1, ["Women's Singles", "Women's Doubles", "Mixed Doubles"]);

    const badmintonRestricted = ["Women's Singles", "Mixed Doubles"];
    const maleCase2 = badmintonRestricted.filter(c => isCategoryApplicableToGender(c, 'Male'));
    assert.deepStrictEqual(maleCase2, ["Mixed Doubles"]);
  });

  // TEST 4: Gender Switch Category Pruning
  await t.test('TEST 4: Prunes invalid category selection when gender changes', () => {
    const selectedCategories = ["Men's Singles", "Mixed Doubles"];
    const switchedToFemale = selectedCategories.filter(c => isCategoryApplicableToGender(c, 'Female'));
    assert.deepStrictEqual(switchedToFemale, ["Mixed Doubles"]);
  });

  // TEST 5: Cryptographic Check-In Token Generation & Verification
  await t.test('TEST 5: Secure HMAC token generation and verification works and rejects tampering', () => {
    const token = generateCheckInToken('p-12345', 'SO-ABCDEF', 'EMP101');
    assert.ok(token, 'Token must be generated');

    const verified = verifyCheckInToken(token);
    assert.ok(verified, 'Valid token must be verified');
    assert.strictEqual(verified.playerId, 'p-12345');
    assert.strictEqual(verified.playerCode, 'SO-ABCDEF');
    assert.strictEqual(verified.employeeId, 'EMP101');

    // Tampered token must fail
    const tampered = token.slice(0, -4) + 'abcd';
    assert.strictEqual(verifyCheckInToken(tampered), null, 'Tampered token must return null');
  });

  // TEST 6: Register a new WALK-IN player via API (Status = REGISTERED)
  const testEmpId = `WALK_${testSuffix}`;
  let registeredPlayerId = '';
  let registeredPlayerCode = '';
  let registeredCheckInToken = '';

  await t.test('TEST 6: Register new WALK-IN player saves status=REGISTERED and returns check_in_token', async () => {
    const regPayload = {
      eventId,
      employee_id: testEmpId,
      name: 'Tannu Jha',
      gender: 'Female',
      contact_info: '9876501234',
      sport: 'Badminton',
      categories: ["Women's Singles"],
      email: 'tannu@example.com'
    };

    const res = await fetch(`${baseUrl}/api/player/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload)
    });

    assert.strictEqual(res.status, 201, 'Registration should return HTTP 201 Created');
    const data = await res.json();
    assert.ok(data.success, 'Response should indicate success');
    assert.strictEqual(data.player.status, 'REGISTERED', 'Player status must initially be REGISTERED');
    assert.ok(data.player.id, 'Player ID must be returned');
    assert.ok(data.player.player_code, 'Player code must be returned');
    assert.ok(data.check_in_token, 'check_in_token must be returned for seamless auto check-in');

    registeredPlayerId = data.player.id;
    registeredPlayerCode = data.player.player_code;
    registeredCheckInToken = data.check_in_token;
    createdPlayerIds.push(registeredPlayerId);

    // Verify directly in DB that status is REGISTERED
    const { data: dbP } = await supabase.from('players').select('status').eq('id', registeredPlayerId).single();
    assert.strictEqual(dbP.status, 'REGISTERED');
  });

  // TEST 7: Automatic Check-In via /api/player/check-in transitions to PRESENT
  await t.test('TEST 7: Automatic check-in via token transitions player REGISTERED -> PRESENT (Section 12 Test 1, 2, 3)', async () => {
    const res = await fetch(`${baseUrl}/api/player/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: registeredPlayerId,
        token: registeredCheckInToken
      })
    });

    assert.strictEqual(res.status, 200, 'Check-in must succeed with HTTP 200');
    const data = await res.json();
    assert.ok(data.success, 'Check-in response must be successful');
    assert.strictEqual(data.player.status, 'PRESENT', 'Returned status must be PRESENT');
    assert.strictEqual(data.player.player_code, registeredPlayerCode, 'Player code must match');
    assert.ok(data.player.check_in_time, 'check_in_time must be set');

    // Direct database check
    const { data: dbPlayer } = await supabase.from('players').select('*').eq('id', registeredPlayerId).single();
    assert.strictEqual(dbPlayer.status, 'PRESENT', 'Database status must be PRESENT');
    assert.ok(dbPlayer.check_in_time, 'check_in_time must be set in database');
  });

  // TEST 8: Automatic Check-In Idempotency (Section 12 Test 4)
  await t.test('TEST 8: Idempotent automatic check-in when player is already PRESENT', async () => {
    const res = await fetch(`${baseUrl}/api/player/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: registeredPlayerId,
        token: registeredCheckInToken
      })
    });

    assert.strictEqual(res.status, 200, 'Subsequent check-in must succeed idempotently');
    const data = await res.json();
    assert.strictEqual(data.player.status, 'PRESENT');

    // Ensure database record remains PRESENT without creating duplicates
    const { data: records } = await supabase.from('players').select('id, status').eq('id', registeredPlayerId);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].status, 'PRESENT');
  });

  // TEST 9: Automatic Check-In Security & Failure Handling (Section 12 Test 5)
  await t.test('TEST 9: Invalid/tampered check-in token is rejected and leaves status intact', async () => {
    // Create another un-checked-in player using base columns
    const { data: testP, error: testPErr } = await supabase.from('players').insert({
      event_id: eventId,
      employee_id: `SEC_${testSuffix}`,
      name: 'Security Test Player',
      sport: 'Badminton',
      category: "Men's Singles",
      contact_info: '9876543210',
      status: 'REGISTERED'
    }).select().single();
    assert.ifError(testPErr);
    assert.ok(testP?.id, 'Test player must be created');
    createdPlayerIds.push(testP.id);

    // Attempt check-in with invalid token
    const res = await fetch(`${baseUrl}/api/player/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: testP.id,
        token: 'invalid.forged_token'
      })
    });

    assert.strictEqual(res.status, 401, 'Invalid token must be rejected with 401');

    // Verify player remains REGISTERED in database
    const { data: pAfter } = await supabase.from('players').select('status').eq('id', testP.id).single();
    assert.strictEqual(pAfter.status, 'REGISTERED', 'Player must remain REGISTERED on check-in failure');
  });

  // TEST 10: Duplicate Employee ID check returns 409
  await t.test('TEST 10: Duplicate Employee ID registration rejected with 409', async () => {
    const res = await fetch(`${baseUrl}/api/player/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        employee_id: testEmpId,
        name: 'Another Name',
        gender: 'Female',
        contact_info: '9999999999',
        sport: 'Badminton',
        categories: ["Women's Singles"]
      })
    });

    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.ok(data.error.includes('Already registered.'));
  });

  // TEST 11: Imported/pre-registered manual check-in workflow intact (Section 12 Test 6)
  await t.test('TEST 11: Imported/pre-registered player manual check-in workflow remains intact', async () => {
    const importedEmpId = `IMP_${testSuffix}`;
    const { data: impPlayer, error: impErr } = await supabase.from('players').insert({
      event_id: eventId,
      employee_id: importedEmpId,
      name: 'Imported Player',
      sport: 'Badminton',
      category: "Men's Singles",
      contact_info: '9123456780',
      status: 'REGISTERED'
    }).select().single();
    assert.ifError(impErr);
    assert.ok(impPlayer?.id, 'Imported player must be created');
    createdPlayerIds.push(impPlayer.id);

    // Manual check-in via employee_id and mobile_no
    const res = await fetch(`${baseUrl}/api/player/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: importedEmpId,
        mobile_no: '9123456780'
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.player.status, 'PRESENT');

    const { data: dbImp } = await supabase.from('players').select('status').eq('id', impPlayer.id).single();
    assert.strictEqual(dbImp.status, 'PRESENT');
  });

  // TEST 12: Admin Management visibility
  await t.test('TEST 12: Admin management displays walk-in player with Gender and Source=WALK-IN', async () => {
    const { data: players } = await supabase
      .from('players')
      .select('*')
      .eq('id', registeredPlayerId);

    assert.ok(players && players.length === 1);
    const p = players[0];
    const source = p.source || p.push_subscription?._metadata?.source;
    const gender = p.gender || p.push_subscription?._metadata?.gender;

    assert.strictEqual(source, 'WALK-IN');
    assert.strictEqual(gender, 'Female');
    assert.strictEqual(p.status, 'PRESENT');
  });

  // TEST 13: Complete Match-Day Workflow for auto-checked-in WALK-IN player (Section 12 Test 7)
  await t.test('TEST 13: Full match-day lifecycle for auto-checked-in player (PRESENT -> CALLED -> LIVE -> COMPLETED)', async () => {
    // 1. Create opponent
    const { data: opponent, error: oppErr } = await supabase.from('players').insert({
      event_id: eventId,
      employee_id: `OPP_${testSuffix}`,
      name: 'Riya Kapoor',
      sport: 'Badminton',
      category: "Women's Singles",
      contact_info: '9876509999',
      status: 'PRESENT',
      check_in_time: new Date().toISOString()
    }).select().single();
    assert.ifError(oppErr);
    createdPlayerIds.push(opponent.id);

    // 2. Schedule match
    const matchTime = new Date(Date.now() + 3600000).toISOString();
    const resMatch = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Women's Singles",
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime: matchTime,
        team1_p1_id: registeredPlayerId,
        team2_p1_id: opponent.id
      })
    });

    assert.strictEqual(resMatch.status, 200);
    const matchData = await resMatch.json();
    const matchId = matchData.match.id;
    createdMatchIds.push(matchId);

    const { data: dbP1 } = await supabase.from('players').select('status').eq('id', registeredPlayerId).single();
    assert.strictEqual(dbP1.status, 'CALLED', 'Auto-checked-in player transitions to CALLED upon match creation');

    // 3. Player responds "I'M COMING"
    const { error: rpcErr } = await supabase.rpc('player_accept_match', {
      p_player_id: registeredPlayerId,
      p_match_id: matchId
    });
    assert.ifError(rpcErr);

    const { data: dbP1AfterComing } = await supabase.from('players').select('status').eq('id', registeredPlayerId).single();
    assert.strictEqual(dbP1AfterComing.status, 'AVAILABLE', 'Status becomes AVAILABLE after I\'M COMING');

    // 4. Admin starts match LIVE
    const liveRes = await fetch(`${baseUrl}/api/matches/start-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId })
    });
    assert.strictEqual(liveRes.status, 200);

    const { data: pLive } = await supabase.from('players').select('status').eq('id', registeredPlayerId).single();
    assert.strictEqual(pLive.status, 'PLAYING', 'Player must be PLAYING when match is LIVE');

    // 5. Complete match
    const compRes = await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId,
        winningTeam: 'team1',
        isWalkover: false
      })
    });
    assert.strictEqual(compRes.status, 200);

    const { data: pAfterMatch } = await supabase.from('players').select('status').eq('id', registeredPlayerId).single();
    assert.strictEqual(pAfterMatch.status, 'PRESENT', 'Checked-in player returns to PRESENT after match completion');
  });
});
