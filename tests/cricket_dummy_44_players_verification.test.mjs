import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import xlsx from 'xlsx';

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

const DUMMY_EXCEL_PATH = '/Users/tannujha/Downloads/SportsOps_Cricket_Dummy_Import.xlsx';

test('CRICKET EXCEL 44-PLAYER IMPORT PIPELINE ACCEPTANCE TEST', async (t) => {
  const testSuffix = Date.now();
  let cricketEventId = null;
  const createdPlayerIds = [];

  t.after(async () => {
    if (createdPlayerIds.length > 0) {
      await supabase.from('players').delete().in('id', createdPlayerIds);
    }
    if (cricketEventId) {
      await supabase.from('events').delete().eq('id', cricketEventId);
    }
  });

  // Stage 1: File reading and inspection
  let rawRows = [];
  await t.test('1. Read and inspect actual Excel file structure', async () => {
    assert.ok(fs.existsSync(DUMMY_EXCEL_PATH), `Excel file not found at ${DUMMY_EXCEL_PATH}`);
    const wb = xlsx.readFile(DUMMY_EXCEL_PATH);
    const sheetName = wb.SheetNames.find(n => /player|roster|import/i.test(n)) || wb.SheetNames[0];
    assert.strictEqual(sheetName, 'Cricket Player Import');

    const sheet = wb.Sheets[sheetName];
    rawRows = xlsx.utils.sheet_to_json(sheet);
    assert.strictEqual(rawRows.length, 44, 'Must contain exactly 44 player rows');

    // Verify Dinesh Sharma exists in raw row 0
    const dineshRow = rawRows.find(r => (r['Name'] || r['Player Name']) === 'Dinesh Sharma');
    assert.ok(dineshRow, 'Dinesh Sharma must be in the uploaded sheet');
    assert.strictEqual(dineshRow['Team Name'], 'Chak De XI');
    assert.strictEqual(dineshRow['Team Captain Name'], 'Dinesh Sharma');
    assert.strictEqual(dineshRow['Employee ID'], '20046');
  });

  // Stage 2: Create test event
  await t.test('2. Create test Cricket event for import validation', async () => {
    const { data: cEvent, error: cErr } = await supabase
      .from('events')
      .insert({
        name: `Cricket 44 Acceptance Test ${testSuffix}`,
        event_date: '2026-10-18',
        venue: 'Corporate Ground',
        sport: 'Cricket',
        configuration: {
          sports: {
            Cricket: {
              enabled: true,
              facilityType: 'Pitches',
              facilityCount: 2,
              categories: ['Open Cricket']
            }
          }
        }
      })
      .select()
      .single();

    assert.ok(!cErr && cEvent, `Failed to create event: ${cErr?.message}`);
    cricketEventId = cEvent.id;
  });

  // Stage 3: Import raw Excel data via API
  await t.test('3. API import endpoint imports all 44 players and 4 teams from Excel', async () => {
    const importRes = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: cricketEventId,
        sport: 'Cricket',
        records: rawRows
      })
    });

    const importData = await importRes.json();
    assert.strictEqual(importRes.status, 200, `Import API failed: ${JSON.stringify(importData)}`);
    assert.strictEqual(importData.success, true);
    assert.strictEqual(importData.summary.sport, 'Cricket');
    assert.strictEqual(importData.summary.totalRows, 44);
    assert.strictEqual(importData.summary.newPlayers, 44);
    assert.strictEqual(importData.summary.teamsDetected, 4);
    assert.strictEqual(importData.summary.skippedRows, 0);

    // Verify all 4 teams detected
    const expectedTeams = ['Chak De XI', 'Boundary Kings', 'Power Hitters', 'Cricket Warriors'];
    assert.deepStrictEqual(importData.summary.teamNames?.sort(), [...expectedTeams].sort());

    // Verify captains detected
    assert.strictEqual(importData.summary.teamCaptains?.['Chak De XI'], 'Dinesh Sharma');
    assert.strictEqual(importData.summary.teamCaptains?.['Boundary Kings'], 'Arjun Malhotra');
    assert.strictEqual(importData.summary.teamCaptains?.['Power Hitters'], 'Neeraj Arora');
    assert.strictEqual(importData.summary.teamCaptains?.['Cricket Warriors'], 'Ravi Mehra');

    // Verify DB records
    const { data: dbPlayers, error: fetchErr } = await supabase
      .from('players')
      .select('*')
      .eq('event_id', cricketEventId);

    assert.ok(!fetchErr && dbPlayers);
    assert.strictEqual(dbPlayers.length, 44, 'All 44 players must exist in database');

    const playerCodes = new Set();
    dbPlayers.forEach((p) => {
      createdPlayerIds.push(p.id);
      const code = p.player_code || p.push_subscription?._metadata?.player_code;
      assert.match(code, /^SO-[2-9A-HJ-NP-Z]{6}$/);
      playerCodes.add(code);

      const teamName = p.team_name || p.push_subscription?._metadata?.team_name;
      assert.ok(expectedTeams.includes(teamName), `Unexpected team: ${teamName}`);
    });

    assert.strictEqual(playerCodes.size, 44, 'All 44 player codes must be unique');

    // Verify Dinesh Sharma in DB
    const dineshInDb = dbPlayers.find(p => p.name === 'Dinesh Sharma');
    assert.ok(dineshInDb, 'Dinesh Sharma must exist in DB');
    const dineshTeam = dineshInDb.team_name || dineshInDb.push_subscription?._metadata?.team_name;
    assert.strictEqual(dineshTeam, 'Chak De XI');
    assert.strictEqual(dineshInDb.push_subscription?._metadata?.captain_name, 'Dinesh Sharma');
    assert.strictEqual(dineshInDb.push_subscription?._metadata?.is_captain, true);
  });

  // Stage 4: Re-import preserving player codes
  await t.test('4. Re-importing preserves existing Player Codes for all 44 players', async () => {
    const { data: beforePlayers } = await supabase
      .from('players')
      .select('*')
      .eq('event_id', cricketEventId);

    const beforeCodesMap = new Map();
    beforePlayers.forEach((p) => {
      const code = p.player_code || p.push_subscription?._metadata?.player_code;
      beforeCodesMap.set(p.name, code);
    });

    // Re-import with same rawRows
    const reImportRes = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: cricketEventId,
        sport: 'Cricket',
        records: rawRows
      })
    });

    const reImportData = await reImportRes.json();
    assert.strictEqual(reImportRes.status, 200, `Re-import failed: ${JSON.stringify(reImportData)}`);
    assert.strictEqual(reImportData.summary.newPlayers, 0);
    assert.strictEqual(reImportData.summary.existingPlayers, 44);

    const { data: afterPlayers } = await supabase
      .from('players')
      .select('*')
      .eq('event_id', cricketEventId);

    assert.strictEqual(afterPlayers.length, 44);
    afterPlayers.forEach((p) => {
      const code = p.player_code || p.push_subscription?._metadata?.player_code;
      assert.strictEqual(code, beforeCodesMap.get(p.name), `Player code changed for ${p.name}`);
    });
  });

  // Stage 5: Test simulated UI preview payload (parsedRecords with teamName)
  await t.test('5. Re-importing with normalized UI payload (teamName, empId) succeeds without Missing Team Name error', async () => {
    // Construct records as produced by browser preview (teamName, empId, name, etc.)
    const uiRecords = rawRows.map((r, idx) => ({
      empId: r['Employee ID'],
      name: r['Name'] || r['Player Name'],
      sport: 'Cricket',
      category: 'Open Cricket',
      teamName: r['Team Name'],
      captainName: r['Team Captain Name'] || r['Captain Name'] || r['Team Captain'],
      email: r['Email ID'] || r['Email'] || null,
      contact: r['Contact'] || r['Mobile'] || null,
      rawRowNumber: idx + 2
    }));

    // Dinesh Sharma in uiRecords
    const dinesh = uiRecords.find(r => r.name === 'Dinesh Sharma');
    assert.ok(dinesh);
    assert.strictEqual(dinesh.teamName, 'Chak De XI');

    const uiImportRes = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: cricketEventId,
        sport: 'Cricket',
        records: uiRecords
      })
    });

    const uiImportData = await uiImportRes.json();
    assert.strictEqual(uiImportRes.status, 200, `UI payload import failed: ${JSON.stringify(uiImportData)}`);
    assert.strictEqual(uiImportData.summary.teamsDetected, 4);
    assert.strictEqual(uiImportData.summary.existingPlayers, 44);
    assert.strictEqual(uiImportData.summary.newPlayers, 0);
  });

  // Stage 6: Header variations tolerance (trailing space, lowercase, underscores)
  await t.test('6. Header variations (e.g. "Team Name ", "team_name") are parsed without errors', async () => {
    const variedRows = [
      {
        'Team Name ': 'Chak De XI', // Trailing space
        'Name': 'Dinesh Sharma',
        'Team Captain Name': 'Dinesh Sharma',
        'Employee ID ': '20046'
      },
      {
        'team_name': 'Chak De XI', // Underscore and lowercase
        'player_name': 'Sandeep Gandas',
        'captain_name': 'Dinesh Sharma',
        'employee_id': '118204'
      }
    ];

    const variedRes = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: cricketEventId,
        sport: 'Cricket',
        records: variedRows
      })
    });

    const variedData = await variedRes.json();
    assert.strictEqual(variedRes.status, 200, `Varied headers failed: ${JSON.stringify(variedData)}`);
    assert.strictEqual(variedData.summary.teamsDetected, 1);
    assert.strictEqual(variedData.summary.existingPlayers, 2);
  });

  // Stage 7: Badminton flow preserves independence
  await t.test('7. Badminton import operates independently without requiring Team Name or Captain', async () => {
    const { data: bEvent } = await supabase
      .from('events')
      .insert({
        name: `Badminton Independent Test ${testSuffix}`,
        event_date: '2026-10-18',
        venue: 'Badminton Hall',
        sport: 'Badminton',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityCount: 2,
              categories: ["Men's Singles"]
            }
          }
        }
      })
      .select()
      .single();

    assert.ok(bEvent);

    const bRows = [
      {
        'Employee ID': `BAD_${testSuffix}_1`,
        'Name': 'Badminton Individual 1',
        'Sport': 'Badminton',
        'Category': "Men's Singles"
      },
      {
        'Employee ID ': `BAD_${testSuffix}_2`, // Trailing space tolerant
        'Player Name': 'Badminton Individual 2',
        'Sport': 'Badminton',
        'Category': "Men's Singles"
      }
    ];

    const bRes = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: bEvent.id,
        sport: 'Badminton',
        records: bRows
      })
    });

    const bData = await bRes.json();
    assert.strictEqual(bRes.status, 200, `Badminton import failed: ${JSON.stringify(bData)}`);
    assert.strictEqual(bData.summary.sport, 'Badminton');
    assert.strictEqual(bData.summary.newPlayers, 2);
    assert.strictEqual(bData.summary.teamsDetected, 0);

    // Cleanup badminton test
    await supabase.from('players').delete().eq('event_id', bEvent.id);
    await supabase.from('events').delete().eq('id', bEvent.id);
  });
});
