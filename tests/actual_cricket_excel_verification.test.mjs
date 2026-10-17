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

const CRICKET_EXCEL_PATH = '/Users/tannujha/Downloads/SportsOps_Cricket_Import.xlsx';

test('VERIFICATION OF ACTUAL CRICKET EXCEL IMPORT', async (t) => {
  const testSuffix = Date.now();
  let testEventId = null;
  const createdPlayerIds = [];

  t.after(async () => {
    if (createdPlayerIds.length > 0) {
      await supabase.from('players').delete().in('id', createdPlayerIds);
    }
    if (testEventId) {
      await supabase.from('events').delete().eq('id', testEventId);
    }
  });

  await t.test('1. Verify actual Excel file exists and sheet structure', async () => {
    assert.ok(fs.existsSync(CRICKET_EXCEL_PATH), `File not found at ${CRICKET_EXCEL_PATH}`);
    const wb = xlsx.readFile(CRICKET_EXCEL_PATH);
    assert.ok(wb.SheetNames.includes('Team Player Import'), 'Must contain Team Player Import sheet');
    const sheet = wb.Sheets['Team Player Import'];
    const rows = xlsx.utils.sheet_to_json(sheet);
    assert.strictEqual(rows.length, 128, 'Actual Excel must contain exactly 128 player rows');
  });

  await t.test('2. Verify import API endpoint with actual Cricket Excel data (First Import)', async () => {
    // Create test Cricket event
    const { data: cEvent, error: cErr } = await supabase
      .from('events')
      .insert({
        name: `Cricket Excel Real Import Test ${testSuffix}`,
        event_date: '2026-10-17',
        venue: 'Cricket Ground',
        sport: 'Cricket',
        configuration: {
          sports: {
            Cricket: {
              enabled: true,
              facilityType: 'Grounds',
              facilityCount: 2,
              categories: ['Open Cricket']
            }
          }
        }
      })
      .select()
      .single();

    assert.ok(!cErr && cEvent, `Failed to create cricket event: ${cErr?.message}`);
    testEventId = cEvent.id;

    // Read the actual file rows
    const wb = xlsx.readFile(CRICKET_EXCEL_PATH);
    const sheet = wb.Sheets['Team Player Import'];
    const rawRows = xlsx.utils.sheet_to_json(sheet);

    // Call API import endpoint
    const importRes = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: testEventId,
        records: rawRows
      })
    });

    const importData = await importRes.json();
    assert.strictEqual(importRes.status, 200, `Import failed with error: ${JSON.stringify(importData)}`);
    assert.strictEqual(importData.success, true);
    assert.strictEqual(importData.summary.sport, 'Cricket');
    assert.strictEqual(importData.summary.totalRows, 128);
    assert.strictEqual(importData.summary.newPlayers, 128);
    assert.strictEqual(importData.summary.existingPlayers, 0);
    assert.strictEqual(importData.summary.teamsDetected, 11, 'Must detect exactly 11 teams');
    assert.strictEqual(importData.summary.skippedRows, 0);
    assert.strictEqual(importData.summary.duplicateRows, 0);

    // Verify all 11 teams are detected
    const expectedTeams = [
      'Chak De XI',
      'Finance 1',
      'NetOps Tigers',
      'SD Champions',
      'Finance 2',
      'Engineering Titans',
      'Engineering Legends',
      'DIO Titans',
      'NetOps Warriors',
      'SD Warriors',
      'NetOps Strikers'
    ];
    for (const team of expectedTeams) {
      assert.ok(importData.summary.teamNames.includes(team), `Missing expected team: ${team}`);
    }

    // Verify DB records
    const { data: dbPlayers, error: fetchErr } = await supabase
      .from('players')
      .select('*')
      .eq('event_id', testEventId);

    assert.ok(!fetchErr && dbPlayers, `Failed to query players: ${fetchErr?.message}`);
    assert.strictEqual(dbPlayers.length, 128, 'All 128 players must be in DB');

    const playerCodes = new Set();
    dbPlayers.forEach((p) => {
      createdPlayerIds.push(p.id);
      const code = p.player_code || p.push_subscription?._metadata?.player_code;
      assert.match(code, /^SO-[2-9A-HJ-NP-Z]{6}$/, `Invalid player code format: ${code}`);
      playerCodes.add(code);

      const teamName = p.team_name || p.push_subscription?._metadata?.team_name;
      assert.ok(expectedTeams.includes(teamName), `Unexpected team name: ${teamName}`);
    });

    assert.strictEqual(playerCodes.size, 128, 'All 128 players must have unique SO- codes');
  });

  await t.test('3. Re-importing the same Excel preserves player codes and marks all 128 as existing', async () => {
    const wb = xlsx.readFile(CRICKET_EXCEL_PATH);
    const sheet = wb.Sheets['Team Player Import'];
    const rawRows = xlsx.utils.sheet_to_json(sheet);

    // Get player codes before re-import
    const { data: beforePlayers, error: beforeErr } = await supabase
      .from('players')
      .select('*')
      .eq('event_id', testEventId);

    assert.ok(!beforeErr && beforePlayers, `Failed to query players before re-import: ${beforeErr?.message}`);
    const beforeCodesMap = new Map();
    beforePlayers.forEach((p) => {
      const code = p.player_code || p.push_subscription?._metadata?.player_code;
      const team = p.push_subscription?._metadata?.team_name;
      beforeCodesMap.set(`${team}_${p.name}`, code);
    });

    // Re-import
    const reImportRes = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: testEventId,
        records: rawRows
      })
    });

    const reImportData = await reImportRes.json();
    assert.strictEqual(reImportRes.status, 200, `Re-import failed: ${JSON.stringify(reImportData)}`);
    assert.strictEqual(reImportData.summary.newPlayers, 0, 'No new players should be added on re-import');
    assert.strictEqual(reImportData.summary.existingPlayers, 128, 'All 128 players must be detected as existing');
    assert.strictEqual(reImportData.summary.teamsDetected, 11);

    // Verify player count is still 128 (no duplicate records created)
    const { data: afterPlayers, error: afterErr } = await supabase
      .from('players')
      .select('*')
      .eq('event_id', testEventId);

    assert.ok(!afterErr && afterPlayers, `Failed to query players after re-import: ${afterErr?.message}`);

    assert.strictEqual(afterPlayers.length, 128, 'Total players in DB must remain 128');

    // Verify all player codes remain unchanged
    afterPlayers.forEach((p) => {
      const code = p.player_code || p.push_subscription?._metadata?.player_code;
      const team = p.push_subscription?._metadata?.team_name;
      const expectedCode = beforeCodesMap.get(`${team}_${p.name}`);
      assert.strictEqual(code, expectedCode, `Player code changed for ${team} - ${p.name}`);
    });
  });
});
