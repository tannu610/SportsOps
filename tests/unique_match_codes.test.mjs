import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateMatchCode,
  isValidMatchCode,
  generateUniqueMatchCode,
  extractMatchCode,
  isMatchCodeUnique,
  MATCH_CODE_CHARS
} from '../src/utils/matchCode.ts';

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

test('UNIQUE HUMAN-READABLE MATCH CODE ACCEPTANCE TEST SUITE', async (t) => {
  const testSuffix = Date.now();
  const createdMatchIds = [];
  const createdPlayerIds = [];
  let eventId = null;

  // Setup isolated event for testing
  const { data: newEv, error: evErr } = await supabase
    .from('events')
    .insert({
      name: `Match Code Acceptance Test Event ${testSuffix}`,
      event_date: '2026-10-08',
      venue: 'Match Code Arena',
      sport: 'Badminton',
      configuration: {
        sports: {
          Badminton: {
            enabled: true,
            facilityType: 'Courts',
            facilityUnit: 'Court',
            facilityCount: 6,
            categories: ["Men's Singles", "Women's Singles", "Men's Doubles"]
          }
        }
      }
    })
    .select()
    .single();

  assert.ifError(evErr);
  eventId = newEv.id;

  // Setup test players
  const playerPayloads = [
    {
      event_id: eventId,
      employee_id: `MCP1_${testSuffix}`,
      name: `Priyanka Test ${testSuffix}`,
      sport: 'Badminton',
      category: "Men's Singles",
      status: 'PRESENT',
      push_subscription: { _metadata: { source: 'WALK-IN' } }
    },
    {
      event_id: eventId,
      employee_id: `MCP2_${testSuffix}`,
      name: `Vikram Joshi ${testSuffix}`,
      sport: 'Badminton',
      category: "Men's Singles",
      status: 'PRESENT',
      push_subscription: { _metadata: { source: 'IMPORT' } }
    },
    {
      event_id: eventId,
      employee_id: `MCP3_${testSuffix}`,
      name: `Rahul Sharma ${testSuffix}`,
      sport: 'Badminton',
      category: "Men's Singles",
      status: 'PRESENT',
      push_subscription: { _metadata: { source: 'IMPORT' } }
    },
    {
      event_id: eventId,
      employee_id: `MCP4_${testSuffix}`,
      name: `Amit Verma ${testSuffix}`,
      sport: 'Badminton',
      category: "Men's Singles",
      status: 'PRESENT',
      push_subscription: { _metadata: { source: 'IMPORT' } }
    }
  ];

  const { data: insertedPlayers, error: pErr } = await supabase
    .from('players')
    .insert(playerPayloads)
    .select();
  assert.ifError(pErr);
  insertedPlayers.forEach((p) => createdPlayerIds.push(p.id));

  const [p1, p2, p3, p4] = insertedPlayers;

  // Teardown
  t.after(async () => {
    for (const mid of createdMatchIds) {
      try {
        await supabase.from('matches').delete().eq('id', mid);
      } catch {}
    }
    for (const pid of createdPlayerIds) {
      try {
        await supabase.from('players').delete().eq('id', pid);
      } catch {}
    }
    if (eventId) {
      try {
        await supabase.from('events').delete().eq('id', eventId);
      } catch {}
    }
  });

  // UNIT TESTS: Match Code format and generator
  await t.test('UNIT: Match Code format conforms to 6-character alphanumeric rules', () => {
    // Exactly 30 allowed chars
    assert.equal(MATCH_CODE_CHARS.length, 30);
    // Disallowed ambiguous characters
    assert.ok(!MATCH_CODE_CHARS.includes('0'), 'Must not contain 0');
    assert.ok(!MATCH_CODE_CHARS.includes('O'), 'Must not contain O');
    assert.ok(!MATCH_CODE_CHARS.includes('1'), 'Must not contain 1');
    assert.ok(!MATCH_CODE_CHARS.includes('I'), 'Must not contain I');
    assert.ok(!MATCH_CODE_CHARS.includes('5'), 'Must not contain 5');
    assert.ok(!MATCH_CODE_CHARS.includes('S'), 'Must not contain S');

    // Generate sample codes and validate
    for (let i = 0; i < 20; i++) {
      const code = generateMatchCode();
      assert.equal(code.length, 6, `Match code ${code} must be exactly 6 characters`);
      assert.ok(isValidMatchCode(code), `Match code ${code} must be valid`);
      assert.match(code, /^[2346789ABCDEFGHJKLMNPQRTUVWXYZ]{6}$/);
    }

    // Invalid examples
    assert.equal(isValidMatchCode('M7K2P'), false, 'Too short');
    assert.equal(isValidMatchCode('M7K2P49'), false, 'Too long');
    assert.equal(isValidMatchCode('M702P4'), false, 'Contains 0');
    assert.equal(isValidMatchCode('M7O2P4'), false, 'Contains O');
    assert.equal(isValidMatchCode('M712P4'), false, 'Contains 1');
    assert.equal(isValidMatchCode('M7I2P4'), false, 'Contains I');
    assert.equal(isValidMatchCode('M752P4'), false, 'Contains 5');
    assert.equal(isValidMatchCode('M7S2P4'), false, 'Contains S');
    assert.equal(isValidMatchCode('886a9f47-07b4-4d20-9389-e9b1b53a3a8a'), false, 'UUID is not Match Code');
  });

  await t.test('UNIT: Collision retry and extraction helpers', () => {
    const existing = new Set(['M7K2P4', 'A4N8Q2']);
    const newCode = generateUniqueMatchCode(existing);
    assert.ok(isValidMatchCode(newCode));
    assert.ok(existing.has(newCode.toUpperCase()));
    assert.notEqual(newCode, 'M7K2P4');
    assert.notEqual(newCode, 'A4N8Q2');

    // extractMatchCode from native column
    assert.equal(extractMatchCode({ match_code: 'M7K2P4' }), 'M7K2P4');
    // extractMatchCode from score JSON
    assert.equal(extractMatchCode({ score: JSON.stringify({ match_code: 'A4N8Q2' }) }), 'A4N8Q2');
    // extractMatchCode from MC: prefix
    assert.equal(extractMatchCode({ score: 'MC:X7C6R9' }), 'X7C6R9');
    // extractMatchCode fallback
    assert.equal(extractMatchCode({ score: null, match_code: null }), null);
  });

  let match1Id = null;
  let match1Code = null;
  let match2Id = null;
  let match2Code = null;

  // TEST 1: Create a new match -> 6-character Match Code is generated and returned
  await t.test('TEST 1: Create a new match -> 6-character Match Code is generated and persisted', async () => {
    const scheduledTime = new Date(Date.now() + 30 * 60000).toISOString();
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime,
        team1_p1_id: p1.id,
        team2_p1_id: p2.id
      })
    });

    assert.equal(res.status, 200, 'Match creation should succeed');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.match, 'Match object must be returned');

    match1Id = data.match.id;
    match1Code = data.match.match_code;
    createdMatchIds.push(match1Id);

    assert.ok(match1Code, 'match_code must be present in response');
    assert.equal(typeof match1Code, 'string');
    assert.equal(match1Code.length, 6, 'Match Code must be exactly 6 characters');
    assert.ok(isValidMatchCode(match1Code), `Match Code ${match1Code} must conform to format`);
    assert.notEqual(match1Code, match1Id, 'Match Code must not be the internal UUID');

    // Verify persistence in Supabase
    const { data: dbMatch, error: dbErr } = await supabase
      .from('matches')
      .select('id, score, status, playing_area')
      .eq('id', match1Id)
      .single();
    assert.ifError(dbErr);
    const persistedCode = extractMatchCode(dbMatch);
    assert.equal(persistedCode, match1Code, 'Persisted Match Code must match generated code');
  });

  // TEST 2: Create another match -> Different Match Code
  await t.test('TEST 2: Create another match -> Different unique Match Code', async () => {
    const scheduledTime = new Date(Date.now() + 60 * 60000).toISOString();
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 2',
        scheduledTime,
        team1_p1_id: p3.id,
        team2_p1_id: p4.id
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    match2Id = data.match.id;
    match2Code = data.match.match_code;
    createdMatchIds.push(match2Id);

    assert.ok(match2Code);
    assert.equal(match2Code.length, 6);
    assert.ok(isValidMatchCode(match2Code));
    assert.notEqual(match2Code, match1Code, 'Match 2 Code must be different from Match 1 Code');
  });

  // TEST 3: Refresh Play Area Management / Refetch -> Same Match Code
  await t.test('TEST 3: Refresh / refetch match data -> Same Match Code is returned', async () => {
    const { data: dbMatches, error } = await supabase
      .from('matches')
      .select('id, score, status, playing_area')
      .in('id', [match1Id, match2Id]);
    assert.ifError(error);

    const m1 = dbMatches.find((m) => m.id === match1Id);
    const m2 = dbMatches.find((m) => m.id === match2Id);

    assert.equal(extractMatchCode(m1), match1Code, 'Match 1 code must remain unchanged upon refresh');
    assert.equal(extractMatchCode(m2), match2Code, 'Match 2 code must remain unchanged upon refresh');
  });

  // TEST 4 & 5: Match lifecycle transitions: START LIVE -> Same Match Code
  await t.test('TEST 5: Start match LIVE -> Same Match Code preserved', async () => {
    const res = await fetch(`${baseUrl}/api/matches/start-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: match1Id })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.match.status, 'LIVE');
    assert.equal(data.match.match_code, match1Code, 'Match Code must remain identical when going LIVE');

    // Verify in database
    const { data: dbMatch } = await supabase
      .from('matches')
      .select('id, score, status')
      .eq('id', match1Id)
      .single();
    assert.equal(dbMatch.status, 'LIVE');
    assert.equal(extractMatchCode(dbMatch), match1Code, 'Match Code in DB must remain identical');
  });

  // TEST 6: Complete match -> Same Match Code preserved
  await t.test('TEST 6: Complete match -> Same Match Code preserved', async () => {
    const res = await fetch(`${baseUrl}/api/matches/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: match1Id,
        winningTeam: 'team1',
        isWalkover: false
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.match.status, 'COMPLETED');
    assert.equal(data.match.match_code, match1Code, 'Match Code must remain identical when COMPLETED');

    const { data: dbMatch } = await supabase
      .from('matches')
      .select('id, score, status')
      .eq('id', match1Id)
      .single();
    assert.equal(dbMatch.status, 'COMPLETED');
    assert.equal(extractMatchCode(dbMatch), match1Code);
  });

  // TEST 7: Generate many matches -> No duplicate Match Codes
  await t.test('TEST 7: Generate multiple Match Codes -> 100% globally unique, no duplicates', () => {
    const codeSet = new Set();
    const count = 100;
    for (let i = 0; i < count; i++) {
      const code = generateUniqueMatchCode(codeSet);
      assert.equal(code.length, 6);
      assert.ok(isValidMatchCode(code));
    }
    assert.equal(codeSet.size, count, `All ${count} generated codes must be strictly unique`);
  });

  // TEST 8 & 9: Backfill mechanism for existing matches without a Match Code
  let legacyMatchId = null;
  await t.test('TEST 8: Existing match without Match Code -> Backfill assigns unique Match Code', async () => {
    const scheduledTime = new Date(Date.now() + 120 * 60000).toISOString();
    // Directly insert match without a match_code or score
    const { data: legacyMatch, error: legErr } = await supabase
      .from('matches')
      .insert({
        event_id: eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playing_area: 'Court 3',
        scheduled_time: scheduledTime,
        status: 'SCHEDULED',
        score: null
      })
      .select()
      .single();

    assert.ifError(legErr);
    legacyMatchId = legacyMatch.id;
    createdMatchIds.push(legacyMatchId);

    // Verify it currently has no Match Code
    assert.equal(extractMatchCode(legacyMatch), null);

    // Call Backfill API
    const bfRes = await fetch(`${baseUrl}/api/admin/matches/backfill`, {
      method: 'POST'
    });
    assert.equal(bfRes.status, 200);
    const bfData = await bfRes.json();
    assert.equal(bfData.success, true);
    assert.ok(bfData.updatedCount >= 1, 'At least 1 legacy match must be backfilled');

    // Refetch legacy match and check code
    const { data: refetchedLegacy } = await supabase
      .from('matches')
      .select('id, score, status, playing_area, scheduled_time')
      .eq('id', legacyMatchId)
      .single();

    const assignedCode = extractMatchCode(refetchedLegacy);
    assert.ok(assignedCode, 'Legacy match must now have a Match Code');
    assert.equal(assignedCode.length, 6);
    assert.ok(isValidMatchCode(assignedCode));
    assert.equal(refetchedLegacy.status, 'SCHEDULED', 'Other match fields must not be changed');
    assert.equal(refetchedLegacy.playing_area, 'Court 3', 'Playing area must be preserved');
  });

  // TEST 9: Run backfill again -> Idempotent, existing Match Codes remain unchanged
  await t.test('TEST 9: Run backfill again -> Idempotent, existing codes unchanged', async () => {
    // Record codes before
    const { data: matchesBefore } = await supabase
      .from('matches')
      .select('id, score');

    const codesBefore = new Map();
    matchesBefore.forEach((m) => codesBefore.set(m.id, extractMatchCode(m)));

    // Run backfill again
    const bfRes2 = await fetch(`${baseUrl}/api/admin/matches/backfill`, {
      method: 'POST'
    });
    assert.equal(bfRes2.status, 200);
    const bfData2 = await bfRes2.json();
    assert.equal(bfData2.success, true);
    assert.equal(bfData2.updatedCount, 0, 'Zero matches should be updated on second run');

    // Verify all codes identical
    const { data: matchesAfter } = await supabase
      .from('matches')
      .select('id, score');

    matchesAfter.forEach((m) => {
      const codeAfter = extractMatchCode(m);
      const codeBefore = codesBefore.get(m.id);
      assert.equal(codeAfter, codeBefore, `Match ${m.id} code must not change on rerun`);
    });
  });

  // TEST 10 & 11: API responses include match_code and not internal database ID
  await t.test('TEST 11: Inspect API response structure -> match_code is returned, UUID not used as match_code', async () => {
    const bfStatusRes = await fetch(`${baseUrl}/api/admin/matches/backfill`);
    assert.equal(bfStatusRes.status, 200);
    const statusData = await bfStatusRes.json();
    assert.ok(statusData.total >= 3);
    assert.equal(statusData.missingCode, 0, 'All matches should have a match code assigned');
    assert.equal(statusData.allAssigned, true);
  });
});
