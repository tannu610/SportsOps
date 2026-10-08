import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  MATCH_HISTORY_EXCEL_COLUMNS,
  generateMatchHistoryFilename,
  formatMatchHistoryRow,
  buildMatchHistoryWorkbook,
  buildMatchHistoryExcelBuffer,
} from '../src/utils/matchHistoryExport.ts';

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

test('ADMIN MATCH HISTORY EXCEL EXPORT ACCEPTANCE TEST SUITE', async (t) => {
  const testSuffix = Date.now();
  const createdMatchIds = [];
  const createdPlayerIds = [];
  let eventId = null;

  // Setup isolated test event
  const { data: newEv, error: evErr } = await supabase
    .from('events')
    .insert({
      name: `Match History Export Test Event ${testSuffix}`,
      event_date: '2026-10-09',
      venue: 'Export Arena',
      sport: 'Badminton',
      configuration: {
        sports: {
          Badminton: {
            enabled: true,
            facilityType: 'Courts',
            facilityUnit: 'Court',
            facilityCount: 6,
            categories: ["Men's Singles", "Women's Singles", "Men's Doubles"],
          },
          'Table Tennis': {
            enabled: true,
            facilityType: 'Tables',
            facilityUnit: 'Table',
            facilityCount: 3,
            categories: ['Open Singles'],
          },
        },
      },
    })
    .select()
    .single();

  assert.ifError(evErr);
  eventId = newEv.id;

  // Helper to create test player
  async function createPlayer(name, code, sport = 'Badminton', category = "Men's Singles") {
    const { data, error } = await supabase
      .from('players')
      .insert([
        {
          event_id: eventId,
          employee_id: `EXP_${code}_${testSuffix}_${Math.random().toString(36).substring(2, 6)}`,
          name,
          sport,
          category,
          status: 'PRESENT',
          check_in_time: new Date().toISOString(),
          push_subscription: { _metadata: { gender: 'Male' } },
        },
      ])
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
        await supabase.from('players').delete().eq('id', pid);
      } catch {}
    }
    if (eventId) {
      try {
        await supabase.from('events').delete().eq('id', eventId);
      } catch {}
    }
  });

  // UNIT TESTS: Match History Export Utilities
  await t.test('UNIT: Dynamic filename generator produces clean, readable filenames', () => {
    const d = new Date(2026, 9, 9); // Oct 9, 2026
    const f1 = generateMatchHistoryFilename(undefined, d);
    assert.strictEqual(f1, 'SportsOps_Match_History_2026-10-09.xlsx');

    const f2 = generateMatchHistoryFilename({ sport: 'Badminton' }, d);
    assert.strictEqual(f2, 'SportsOps_Match_History_Badminton_2026-10-09.xlsx');

    const f3 = generateMatchHistoryFilename(
      { sport: 'Table Tennis', category: "Men's Singles" },
      d
    );
    assert.strictEqual(f3, 'SportsOps_Match_History_Table_Tennis_Men_s_Singles_2026-10-09.xlsx');
  });

  await t.test('UNIT: Column headers and row formatting contain all 12 required columns', () => {
    assert.deepStrictEqual(MATCH_HISTORY_EXCEL_COLUMNS, [
      'Match Code',
      'Sport',
      'Category',
      'Round',
      'Play Area / Court',
      'Player 1 / Team 1',
      'Player 2 / Team 2',
      'Referee',
      'Winner',
      'Result / Score',
      'Match Time',
      'Completed At',
    ]);

    const sampleRow = formatMatchHistoryRow({
      match_code: 'A4N8Q2',
      sport: 'Badminton',
      category: "Men's Singles",
      phase: 'Round 1',
      playing_area: 'Court 2',
      team1_names: 'Anuj Sharma',
      team2_names: 'Tannu Jha',
      referee_name: 'Ankur',
      winner_name: 'Anuj Sharma',
      score_notes: '21-18, 21-19',
      scheduled_time: '2026-10-09T15:30:00.000Z',
      completed_at: '2026-10-09T16:15:00.000Z',
    });

    assert.strictEqual(sampleRow.length, 12);
    assert.strictEqual(sampleRow[0], 'A4N8Q2');
    assert.strictEqual(sampleRow[1], 'Badminton');
    assert.strictEqual(sampleRow[2], "Men's Singles");
    assert.strictEqual(sampleRow[3], 'Round 1');
    assert.strictEqual(sampleRow[4], 'Court 2');
    assert.strictEqual(sampleRow[5], 'Anuj Sharma');
    assert.strictEqual(sampleRow[6], 'Tannu Jha');
    assert.strictEqual(sampleRow[7], 'Ankur');
    assert.strictEqual(sampleRow[8], 'Anuj Sharma');
    assert.strictEqual(sampleRow[9], '21-18, 21-19');
  });

  await t.test('UNIT: Excel workbook builder formats worksheet, sheet name, cell types, freeze row', () => {
    const wb = buildMatchHistoryWorkbook([
      {
        match_code: 'A4N8Q2',
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playing_area: 'Court 2',
        team1_names: 'Player One',
        team2_names: 'Player Two',
        referee_name: 'Official Referee',
        winner_name: 'Player One',
        score_notes: '21-18',
        scheduled_time: '2026-10-09T15:30:00.000Z',
        completed_at: '2026-10-09T16:15:00.000Z',
      },
    ]);

    assert.deepStrictEqual(wb.SheetNames, ['Match History']);
    const ws = wb.Sheets['Match History'];
    assert.ok(ws['!cols']);
    assert.strictEqual(ws['!cols'].length, 12);
    assert.ok(ws['!freeze'] || ws['!views']);

    // Check that score cell type is strictly string 's'
    const scoreCell = ws['J2'];
    assert.strictEqual(scoreCell.t, 's');
    assert.strictEqual(scoreCell.v, '21-18');

    // Verify buffer generator produces valid binary
    const buf = buildMatchHistoryExcelBuffer([
      {
        match_code: 'A4N8Q2',
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playing_area: 'Court 2',
        team1_names: 'Player One',
        team2_names: 'Player Two',
        referee_name: 'Official Referee',
        winner_name: 'Player One',
        score_notes: '21-18',
        scheduled_time: '2026-10-09T15:30:00.000Z',
        completed_at: '2026-10-09T16:15:00.000Z',
      },
    ]);
    assert.ok(buf instanceof Buffer);
    assert.ok(buf.length > 0);
  });

  // SETUP TEST DATA:
  // Match 1: Badminton, Men's Singles, Round 1, Referee Ankur, Winner P1, Score 21-18 (COMPLETED)
  const p1 = await createPlayer('Player One', 'P1', 'Badminton', "Men's Singles");
  const p2 = await createPlayer('Player Two', 'P2', 'Badminton', "Men's Singles");

  const m1Res = await fetch(`${baseUrl}/api/matches/create`, {
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
    }),
  });
  assert.strictEqual(m1Res.status, 200);
  const m1Data = await m1Res.json();
  const match1Code = m1Data.match.match_code;
  createdMatchIds.push(m1Data.match.id);

  // Start & Complete Match 1 via referee API
  const start1Res = await fetch(`${baseUrl}/api/referee/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchCode: match1Code, refereeName: 'Ankur' }),
  });
  assert.strictEqual(start1Res.status, 200);
  const comp1Res = await fetch(`${baseUrl}/api/referee/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchCode: match1Code,
      refereeName: 'Ankur',
      winningTeam: 'team1',
      winnerId: p1.id,
      scoreNotes: '21-18',
    }),
  });
  assert.strictEqual(comp1Res.status, 200);

  // Match 2: Table Tennis, Open Singles, Final, Referee Vikas, Winner P4, Score 11-9 (COMPLETED)
  const p3 = await createPlayer('Player Three', 'P3', 'Table Tennis', 'Open Singles');
  const p4 = await createPlayer('Player Four', 'P4', 'Table Tennis', 'Open Singles');

  const m2Res = await fetch(`${baseUrl}/api/matches/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId,
      sport: 'Table Tennis',
      category: 'Open Singles',
      phase: 'Final',
      playingArea: 'Table 1',
      scheduledTime: new Date(Date.now() + 7200000).toISOString(),
      team1_p1_id: p3.id,
      team2_p1_id: p4.id,
    }),
  });
  assert.strictEqual(m2Res.status, 200);
  const m2Data = await m2Res.json();
  const match2Code = m2Data.match.match_code;
  createdMatchIds.push(m2Data.match.id);

  const start2Res = await fetch(`${baseUrl}/api/referee/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchCode: match2Code, refereeName: 'Vikas' }),
  });
  assert.strictEqual(start2Res.status, 200);
  const comp2Res = await fetch(`${baseUrl}/api/referee/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchCode: match2Code,
      refereeName: 'Vikas',
      winningTeam: 'team2',
      winnerId: p4.id,
      scoreNotes: '11-9',
    }),
  });
  assert.strictEqual(comp2Res.status, 200);

  // Match 3: Badminton, Men's Doubles, Semi-Final, Referee Ankur, Winner Doubles Team 1 (COMPLETED)
  const p5 = await createPlayer('Player Five', 'P5', 'Badminton', "Men's Doubles");
  const p6 = await createPlayer('Player Six', 'P6', 'Badminton', "Men's Doubles");
  const p7 = await createPlayer('Player Seven', 'P7', 'Badminton', "Men's Doubles");
  const p8 = await createPlayer('Player Eight', 'P8', 'Badminton', "Men's Doubles");

  const m3Res = await fetch(`${baseUrl}/api/matches/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId,
      sport: 'Badminton',
      category: "Men's Doubles",
      phase: 'Semi-Final',
      playingArea: 'Court 2',
      scheduledTime: new Date(Date.now() + 10800000).toISOString(),
      team1_p1_id: p5.id,
      team1_p2_id: p6.id,
      team2_p1_id: p7.id,
      team2_p2_id: p8.id,
    }),
  });
  assert.strictEqual(m3Res.status, 200);
  const m3Data = await m3Res.json();
  const match3Code = m3Data.match.match_code;
  createdMatchIds.push(m3Data.match.id);

  const start3Res = await fetch(`${baseUrl}/api/referee/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchCode: match3Code, refereeName: 'Ankur' }),
  });
  assert.strictEqual(start3Res.status, 200);
  const comp3Res = await fetch(`${baseUrl}/api/referee/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchCode: match3Code,
      refereeName: 'Ankur',
      winningTeam: 'team1',
      winnerId: p5.id,
      scoreNotes: '21-19, 21-17',
    }),
  });
  assert.strictEqual(comp3Res.status, 200);

  // Match 4: Non-completed match (SCHEDULED) -> MUST NOT APPEAR IN EXPORT
  const p9 = await createPlayer('Player Nine', 'P9', 'Badminton', "Men's Singles");
  const p10 = await createPlayer('Player Ten', 'P10', 'Badminton', "Men's Singles");
  const m4Res = await fetch(`${baseUrl}/api/matches/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId,
      sport: 'Badminton',
      category: "Men's Singles",
      phase: 'Round 2',
      playingArea: 'Court 3',
      scheduledTime: new Date(Date.now() + 14400000).toISOString(),
      team1_p1_id: p9.id,
      team2_p1_id: p10.id,
    }),
  });
  assert.strictEqual(m4Res.status, 200);
  const m4Data = await m4Res.json();
  const match4Code = m4Data.match.match_code;
  createdMatchIds.push(m4Data.match.id);

  // ACCEPTANCE TESTS:

  // TEST A: No filters -> Exports all completed match-history records for event
  await t.test('A. No filters -> exports all completed match-history records', async () => {
    const res = await fetch(`${baseUrl}/api/admin/history/export?eventId=${eventId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const contentDisposition = res.headers.get('content-disposition');
    assert.ok(contentDisposition.includes('attachment; filename="SportsOps_Match_History_'));
    assert.ok(contentDisposition.endsWith('.xlsx"'));

    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
    assert.deepStrictEqual(wb.SheetNames, ['Match History']);

    const sheet = wb.Sheets['Match History'];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    // Row 0: Headers
    assert.deepStrictEqual(rows[0], MATCH_HISTORY_EXCEL_COLUMNS);
    // Rows 1-3: Exactly 3 completed matches (matches 1, 2, 3). Match 4 (scheduled) is excluded.
    assert.strictEqual(rows.length, 4);

    const codes = [rows[1][0], rows[2][0], rows[3][0]];
    assert.ok(codes.includes(match1Code));
    assert.ok(codes.includes(match2Code));
    assert.ok(codes.includes(match3Code));
    assert.ok(!codes.includes(match4Code));
  });

  // TEST B: Sport filter -> Exports only selected sport
  await t.test('B. Sport filter -> exports only selected sport', async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/history/export?eventId=${eventId}&sport=Table%20Tennis`
    );
    assert.strictEqual(res.status, 200);

    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Match History'], { header: 1 });

    // Should have Header + exactly 1 match (Match 2: Table Tennis)
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1][0], match2Code);
    assert.strictEqual(rows[1][1], 'Table Tennis');
    assert.strictEqual(rows[1][7], 'Vikas');
  });

  // TEST C: Category filter -> Exports only selected category
  await t.test('C. Category filter -> exports only selected category', async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/history/export?eventId=${eventId}&category=Men%27s%20Doubles`
    );
    assert.strictEqual(res.status, 200);

    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Match History'], { header: 1 });

    // Header + Match 3 (Men's Doubles)
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1][0], match3Code);
    assert.strictEqual(rows[1][2], "Men's Doubles");
    // Verify doubles players formatting: both players present
    assert.strictEqual(rows[1][5], 'Player Five & Player Six');
    assert.strictEqual(rows[1][6], 'Player Seven & Player Eight');
  });

  // TEST D: Round filter -> Exports only selected round
  await t.test('D. Round filter -> exports only selected round', async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/history/export?eventId=${eventId}&round=Final`
    );
    assert.strictEqual(res.status, 200);

    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Match History'], { header: 1 });

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1][0], match2Code);
    assert.strictEqual(rows[1][3], 'Final');
  });

  // TEST E: Referee filter -> Exports only selected referee
  await t.test('E. Referee filter -> exports only selected referee', async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/history/export?eventId=${eventId}&referee=Ankur`
    );
    assert.strictEqual(res.status, 200);

    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Match History'], { header: 1 });

    // Matches 1 and 3 were refereed by Ankur
    assert.strictEqual(rows.length, 3);
    const codes = [rows[1][0], rows[2][0]];
    assert.ok(codes.includes(match1Code));
    assert.ok(codes.includes(match3Code));
    assert.strictEqual(rows[1][7], 'Ankur');
    assert.strictEqual(rows[2][7], 'Ankur');
  });

  // TEST F: Multiple filters together -> Exports exact intersection
  await t.test('F. Multiple filters together -> exports exact intersection', async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/history/export?eventId=${eventId}&sport=Badminton&round=Semi-Final`
    );
    assert.strictEqual(res.status, 200);

    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Match History'], { header: 1 });

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1][0], match3Code);
    assert.strictEqual(rows[1][1], 'Badminton');
    assert.strictEqual(rows[1][3], 'Semi-Final');
  });

  // TEST G: Search + filters -> Exports only matching records
  await t.test('G. Search + filters -> exports only matching records', async () => {
    // Search for "Player Five" with sport=Badminton
    const res = await fetch(
      `${baseUrl}/api/admin/history/export?eventId=${eventId}&sport=Badminton&search=Player%20Five`
    );
    assert.strictEqual(res.status, 200);

    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Match History'], { header: 1 });

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1][0], match3Code);
    assert.ok(rows[1][5].includes('Player Five'));
  });

  // TEST H: Zero matching records -> No file download and clear message
  await t.test('H. Zero matching records -> returns 404 with clear error message', async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/history/export?eventId=${eventId}&sport=Cricket`
    );
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(
      data.error,
      'No match history records found for the selected filters.'
    );
  });

  // TEST I: Verify deleted/rescheduled/non-completed matches never appear
  await t.test('I. Verify deleted/rescheduled/non-completed matches never appear', async () => {
    // Match 4 is SCHEDULED
    const res = await fetch(
      `${baseUrl}/api/admin/history/export?eventId=${eventId}&search=${match4Code}`
    );
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(
      data.error,
      'No match history records found for the selected filters.'
    );
  });

  // TEST J: Verify exported values match Match History UI exactly
  await t.test('J. Verify exported values match Match History UI exactly', async () => {
    // Fetch JSON from /api/admin/history
    const jsonRes = await fetch(`${baseUrl}/api/admin/history?eventId=${eventId}`);
    assert.strictEqual(jsonRes.status, 200);
    const jsonData = await jsonRes.json();

    // Fetch Excel from /api/admin/history/export
    const excelRes = await fetch(`${baseUrl}/api/admin/history/export?eventId=${eventId}`);
    assert.strictEqual(excelRes.status, 200);
    const ab = await excelRes.arrayBuffer();
    const wb = XLSX.read(Buffer.from(ab), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Match History'], { header: 1 });

    assert.strictEqual(rows.length - 1, jsonData.history.length);

    // Verify row for Match 1
    const rowMatch1 = rows.find((r) => r[0] === match1Code);
    assert.ok(rowMatch1);
    assert.strictEqual(rowMatch1[1], 'Badminton'); // Sport
    assert.strictEqual(rowMatch1[2], "Men's Singles"); // Category
    assert.strictEqual(rowMatch1[3], 'Round 1'); // Round
    assert.strictEqual(rowMatch1[4], 'Court 1'); // Play Area
    assert.strictEqual(rowMatch1[5], 'Player One'); // Player 1 / Team 1
    assert.strictEqual(rowMatch1[6], 'Player Two'); // Player 2 / Team 2
    assert.strictEqual(rowMatch1[7], 'Ankur'); // Referee
    assert.strictEqual(rowMatch1[8], 'Player One'); // Winner
    assert.strictEqual(rowMatch1[9], '21-18'); // Result / Score preserved as string
    assert.ok(rowMatch1[10] && rowMatch1[10] !== '-'); // Match Time
    assert.ok(rowMatch1[11] && rowMatch1[11] !== '-'); // Completed At
  });
});
