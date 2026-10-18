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

const PROD_CRICKET_EVENT_ID = 'db13c9f2-1670-46c9-852a-6f29085d9c08';

test('CRICKET TEAMS & MATCHDAY COMPREHENSIVE ACCEPTANCE TEST SUITE', async (t) => {
  const cleanupMatchIds = [];
  const cleanupNotificationIds = [];
  const cleanupPlayerIds = [];

  t.after(async () => {
    if (cleanupNotificationIds.length > 0) {
      await supabase.from('notifications').delete().in('id', cleanupNotificationIds);
    }
    if (cleanupMatchIds.length > 0) {
      await supabase.from('matches').delete().in('id', cleanupMatchIds);
    }
    if (cleanupPlayerIds.length > 0) {
      await supabase.from('players').delete().in('id', cleanupPlayerIds);
    }
    // Restore any CALLED players back to their attendance status based on check_in_time
    const { data: calledPlayers } = await supabase
      .from('players')
      .select('id, check_in_time')
      .eq('event_id', PROD_CRICKET_EVENT_ID)
      .eq('status', 'CALLED');

    if (calledPlayers && calledPlayers.length > 0) {
      for (const p of calledPlayers) {
        const resetStatus = p.check_in_time ? 'PRESENT' : 'REGISTERED';
        await supabase.from('players').update({ status: resetStatus }).eq('id', p.id);
      }
    }
  });

  // A. Existing 44 Cricket players are preserved
  await t.test('A. Existing 44 Cricket players are preserved in production event', async () => {
    const { data: players, error } = await supabase
      .from('players')
      .select('id, employee_id, name, sport, push_subscription')
      .eq('event_id', PROD_CRICKET_EVENT_ID);

    assert.ifError(error);
    assert.strictEqual(players.length, 44, 'Should have exactly 44 players');

    // Confirm all 44 players have valid player codes
    players.forEach((p) => {
      const code = p.push_subscription?._metadata?.player_code;
      assert.ok(code, `Player ${p.name} missing player_code`);
      assert.match(code, /^SO-[A-Z0-9]{6}$/, `Invalid player code format: ${code}`);
    });
  });

  // B. Four teams are detected
  let teamsData = null;
  await t.test('B. Four teams are detected via /api/admin/teams', async () => {
    const res = await fetch(`${baseUrl}/api/admin/teams?eventId=${PROD_CRICKET_EVENT_ID}&sport=Cricket`);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.teamsCount, 4, 'Should detect exactly 4 teams');

    teamsData = json.teams;
    const teamNames = teamsData.map((t) => t.teamName).sort();
    assert.deepStrictEqual(teamNames, [
      'Boundary Kings',
      'Chak De XI',
      'Cricket Warriors',
      'Power Hitters'
    ]);
  });

  // C. Each team has exactly 11 players
  await t.test('C. Each team has exactly 11 players', async () => {
    assert.ok(teamsData && teamsData.length === 4);
    teamsData.forEach((team) => {
      assert.strictEqual(team.playerCount, 11, `Team ${team.teamName} should have 11 players, found ${team.playerCount}`);
      assert.strictEqual(team.players.length, 11, `Team ${team.teamName} players array should have 11 items`);
    });
  });

  // D. Captains are correctly linked
  await t.test('D. Captains are correctly linked to teams', async () => {
    const expectedCaptains = {
      'Boundary Kings': 'Arjun Malhotra',
      'Chak De XI': 'Dinesh Sharma',
      'Cricket Warriors': 'Ravi Mehra',
      'Power Hitters': 'Neeraj Arora'
    };

    teamsData.forEach((team) => {
      const expectedName = expectedCaptains[team.teamName];
      assert.strictEqual(team.captainName, expectedName, `Team ${team.teamName} captain should be ${expectedName}`);
      assert.ok(team.captainPlayerId, `Team ${team.teamName} missing captainPlayerId`);

      // Verify the captain is in the team roster with isCaptain = true
      const captainMember = team.players.find((p) => p.id === team.captainPlayerId);
      assert.ok(captainMember, `Captain ${expectedName} should be present in team roster`);
      assert.strictEqual(captainMember.isCaptain, true, `Captain ${expectedName} must have isCaptain: true`);
    });
  });

  // E. Re-running migration / backfill creates no duplicates
  await t.test('E. Re-running backfill is idempotent and creates no duplicates', async () => {
    const backfillRes = await fetch(`${baseUrl}/api/admin/teams/backfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: PROD_CRICKET_EVENT_ID })
    });

    assert.strictEqual(backfillRes.status, 200);
    const bfData = await backfillRes.json();
    assert.strictEqual(bfData.success, true);
    assert.strictEqual(bfData.totalCricketPlayers, 44);
    assert.strictEqual(bfData.teamsDetected.length, 4);

    // Verify team count from /api/admin/teams remains exactly 4
    const res = await fetch(`${baseUrl}/api/admin/teams?eventId=${PROD_CRICKET_EVENT_ID}&sport=Cricket`);
    const json = await res.json();
    assert.strictEqual(json.teamsCount, 4);
    assert.strictEqual(json.totalPlayers, 44);
  });

  // F. Cricket Match page endpoint returns all 4 teams including non-checked-in rosters
  await t.test('F. Cricket team retrieval includes all teams with non-checked-in players', async () => {
    const powerHitters = teamsData.find((t) => t.teamName === 'Power Hitters');
    assert.ok(powerHitters, 'Power Hitters team must exist');
    assert.strictEqual(powerHitters.playerCount, 11, 'Power Hitters must have 11 players');
    assert.strictEqual(powerHitters.players.length, 11, 'Power Hitters must have 11 player records');
    // Ensure players have valid statuses (REGISTERED, PRESENT, or CALLED)
    powerHitters.players.forEach((p) => {
      assert.ok(['REGISTERED', 'PRESENT', 'CALLED'].includes(p.status), `Unexpected status: ${p.status}`);
    });
  });

  // G. Cricket match creation uses team IDs and stores team references
  let createdMatch = null;
  await t.test('G. Cricket match creation uses team IDs and creates match', async () => {
    const t1 = teamsData.find((t) => t.teamName === 'Boundary Kings');
    const t2 = teamsData.find((t) => t.teamName === 'Power Hitters');

    const scheduledTime = new Date(Date.now() + 7200000).toISOString();
    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: PROD_CRICKET_EVENT_ID,
        sport: 'Cricket',
        category: 'Open Cricket',
        phase: 'Round 1',
        playingArea: 'Ground 2',
        scheduledTime,
        team1_id: t1.teamId,
        team2_id: t2.teamId,
        team1_name: t1.teamName,
        team2_name: t2.teamName
      })
    });

    assert.strictEqual(createRes.status, 200);
    const createData = await createRes.json();
    assert.strictEqual(createData.success, true);
    assert.ok(createData.match?.id);

    createdMatch = createData.match;
    cleanupMatchIds.push(createdMatch.id);

    if (createData.notifications) {
      createData.notifications.forEach((n) => cleanupNotificationIds.push(n.id));
    }

    // Verify match code format
    assert.match(createData.match.match_code, /^[A-Z0-9]{6}$/);

    // Verify backward-compatible captain mapping
    assert.strictEqual(createdMatch.team1_p1_id, t1.captainPlayerId);
    assert.strictEqual(createdMatch.team2_p1_id, t2.captainPlayerId);
  });

  // H. All players from both teams receive CALLED status and notifications
  await t.test('H. All 22 players from both teams receive CALLED status and notifications', async () => {
    const t1 = teamsData.find((t) => t.teamName === 'Boundary Kings');
    const t2 = teamsData.find((t) => t.teamName === 'Power Hitters');
    const allExpectedPlayerIds = [...t1.players.map((p) => p.id), ...t2.players.map((p) => p.id)];

    // Fetch players from database to check status
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, name, status')
      .in('id', allExpectedPlayerIds);

    assert.strictEqual(dbPlayers.length, 22);
    dbPlayers.forEach((p) => {
      assert.strictEqual(p.status, 'CALLED', `Player ${p.name} should have status CALLED, found ${p.status}`);
    });

    // Check notifications created
    const { data: notifs } = await supabase
      .from('notifications')
      .select('id, player_id, type')
      .eq('match_id', createdMatch.id);

    assert.strictEqual(notifs.length, 22, 'All 22 players should have received a notification');
    notifs.forEach((n) => cleanupNotificationIds.push(n.id));
  });

  // I. Badminton import and match creation continue working exactly as before
  await t.test('I. Badminton individual player match creation works without teams', async () => {
    // Fetch two badminton players or create temporary badminton players
    const { data: bPlayers } = await supabase
      .from('players')
      .select('id, employee_id, status')
      .eq('sport', 'Badminton')
      .limit(2);

    let p1Id = bPlayers?.[0]?.id;
    let p2Id = bPlayers?.[1]?.id;

    if (!p1Id || !p2Id) {
      // Create 2 test badminton players
      const { data: newBadminton } = await supabase
        .from('players')
        .insert([
          {
            event_id: PROD_CRICKET_EVENT_ID,
            employee_id: `BM_TEST_1_${Date.now()}`,
            name: 'Badminton Test Player 1',
            sport: 'Badminton',
            category: "Men's Singles",
            status: 'PRESENT',
            push_subscription: { _metadata: { player_code: 'SO-BM0001', source: 'TEST' } }
          },
          {
            event_id: PROD_CRICKET_EVENT_ID,
            employee_id: `BM_TEST_2_${Date.now()}`,
            name: 'Badminton Test Player 2',
            sport: 'Badminton',
            category: "Men's Singles",
            status: 'PRESENT',
            push_subscription: { _metadata: { player_code: 'SO-BM0002', source: 'TEST' } }
          }
        ])
        .select('id');

      p1Id = newBadminton[0].id;
      p2Id = newBadminton[1].id;
      cleanupPlayerIds.push(p1Id, p2Id);
    }

    const bScheduledTime = new Date(Date.now() + 10800000).toISOString();
    const bRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: PROD_CRICKET_EVENT_ID,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playingArea: 'Court 1',
        scheduledTime: bScheduledTime,
        team1_p1_id: p1Id,
        team2_p1_id: p2Id
      })
    });

    assert.strictEqual(bRes.status, 200);
    const bData = await bRes.json();
    assert.strictEqual(bData.success, true);
    assert.strictEqual(bData.match.sport, 'Badminton');
    assert.strictEqual(bData.match.team1_p1_id, p1Id);
    assert.strictEqual(bData.match.team2_p1_id, p2Id);
    cleanupMatchIds.push(bData.match.id);
  });

  // J. Player Codes remain unchanged after migration/re-import
  await t.test('J. Player Codes remain identical and intact', async () => {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, push_subscription')
      .eq('event_id', PROD_CRICKET_EVENT_ID);

    const captains = [
      { name: 'Arjun Malhotra', code: 'SO-WSZSVD' },
      { name: 'Dinesh Sharma', code: 'SO-N52KFE' },
      { name: 'Ravi Mehra', code: 'SO-PH2BSA' },
      { name: 'Neeraj Arora', code: 'SO-56SDF4' }
    ];

    captains.forEach((cap) => {
      const p = players.find((pl) => pl.name === cap.name);
      assert.ok(p, `Player ${cap.name} not found`);
      const actualCode = p.push_subscription?._metadata?.player_code;
      assert.strictEqual(actualCode, cap.code, `Player code for ${cap.name} changed! Expected ${cap.code}, got ${actualCode}`);
    });
  });
});
