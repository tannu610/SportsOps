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

test('DATABASE LAYER: Event Configuration (Sports, Categories, Facilities)', async (t) => {
  const createdEventIds = [];

  t.after(async () => {
    // Cleanup any events created during test
    for (const eid of createdEventIds) {
      // Deleting event cascades to event_sports, event_categories, event_facilities
      try {
        await supabase.from('event_sports').delete().eq('event_id', eid);
        await supabase.from('events').delete().eq('id', eid);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // 1. Validation Tests
  await t.test('1. Validations: Event Name, Date, Venue, Sports, Categories, and Facilities', async (t2) => {
    // A: Missing name
    const resNoName = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '',
        eventDate: '2026-10-01',
        venue: 'Main Arena',
        configuration: { sports: { Badminton: { enabled: true, facilityType: 'Courts', facilityCount: 6, categories: ['Men Singles'] } } }
      })
    });
    assert.equal(resNoName.status, 400);
    const dataNoName = await resNoName.json();
    assert.match(dataNoName.error, /Event Name is required/i);

    // B: Missing date
    const resNoDate = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Tournament',
        eventDate: '',
        venue: 'Main Arena',
        configuration: { sports: { Badminton: { enabled: true, facilityType: 'Courts', facilityCount: 6, categories: ['Men Singles'] } } }
      })
    });
    assert.equal(resNoDate.status, 400);
    const dataNoDate = await resNoDate.json();
    assert.match(dataNoDate.error, /Event Date is required/i);

    // C: Missing venue
    const resNoVenue = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Tournament',
        eventDate: '2026-10-01',
        venue: '',
        configuration: { sports: { Badminton: { enabled: true, facilityType: 'Courts', facilityCount: 6, categories: ['Men Singles'] } } }
      })
    });
    assert.equal(resNoVenue.status, 400);
    const dataNoVenue = await resNoVenue.json();
    assert.match(dataNoVenue.error, /Venue is required/i);

    // D: No sports selected
    const resNoSports = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Tournament',
        eventDate: '2026-10-01',
        venue: 'Main Arena',
        configuration: { sports: {} }
      })
    });
    assert.equal(resNoSports.status, 400);

    // E: Non-positive facility count
    const resBadCount = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Tournament',
        eventDate: '2026-10-01',
        venue: 'Main Arena',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityCount: 0, // Invalid: must be positive
              categories: ['Men Singles']
            }
          }
        }
      })
    });
    assert.equal(resBadCount.status, 400);
    const dataBadCount = await resBadCount.json();
    assert.match(dataBadCount.error, /positive integer/i);

    // F: Sport with no categories
    const resNoCat = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Tournament',
        eventDate: '2026-10-01',
        venue: 'Main Arena',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityCount: 4,
              categories: [] // Invalid: at least one category required
            }
          }
        }
      })
    });
    assert.equal(resNoCat.status, 400);
    const dataNoCat = await resNoCat.json();
    assert.match(dataNoCat.error, /category/i);
  });

  // 2. Create single-sport event
  let singleSportEventId;
  await t.test('2. Create single-sport event with custom facilities and categories', async () => {
    const res = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Inter-City Badminton Open 2026',
        eventDate: '2026-11-05',
        venue: 'City Badminton Complex',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityUnit: 'Court',
              facilityCount: 6,
              categories: ["Men's Singles", "Women's Singles", "Mixed Doubles"]
            }
          }
        }
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200, `Save single-sport failed: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);
    assert.ok(data.event?.id);
    singleSportEventId = data.event.id;
    createdEventIds.push(singleSportEventId);

    // Verify retrieval by eventId
    const getRes = await fetch(`${baseUrl}/api/admin/event/config?eventId=${singleSportEventId}`);
    const getData = await getRes.json();

    assert.equal(getData.event.name, 'Inter-City Badminton Open 2026');
    assert.equal(getData.event.venue, 'City Badminton Complex');
    assert.equal(getData.event.event_date, '2026-11-05');

    const badminton = getData.configuration.sports['Badminton'];
    assert.equal(badminton.enabled, true);
    assert.equal(badminton.facilityType, 'Courts');
    assert.equal(badminton.facilityCount, 6);
    assert.deepEqual(badminton.categories, ["Men's Singles", "Women's Singles", "Mixed Doubles"]);
  });

  // 3. Create multi-sport event with different facility types
  let multiSportEventId;
  await t.test('3. Create multi-sport event with different facility types (Courts, Tables, Grounds)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Olympics Campus Games 2026',
        eventDate: '2026-12-10',
        venue: 'National Sports Arena',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityUnit: 'Court',
              facilityCount: 6,
              categories: ["Men's Singles", "Women's Singles"]
            },
            'Table Tennis': {
              enabled: true,
              facilityType: 'Tables',
              facilityUnit: 'Table',
              facilityCount: 4,
              categories: ["Men's Singles", "Mixed Doubles"]
            },
            Cricket: {
              enabled: true,
              facilityType: 'Grounds',
              facilityUnit: 'Ground',
              facilityCount: 2,
              categories: ['Box Cricket', 'Open Men']
            }
          }
        }
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    multiSportEventId = data.event.id;
    createdEventIds.push(multiSportEventId);

    // Verify multi-sport persistence
    const getRes = await fetch(`${baseUrl}/api/admin/event/config?eventId=${multiSportEventId}`);
    const getData = await getRes.json();

    assert.equal(getData.event.name, 'Olympics Campus Games 2026');
    const sports = getData.configuration.sports;
    assert.equal(sports['Badminton'].facilityCount, 6);
    assert.equal(sports['Badminton'].facilityType, 'Courts');
    assert.equal(sports['Table Tennis'].facilityCount, 4);
    assert.equal(sports['Table Tennis'].facilityType, 'Tables');
    assert.equal(sports['Cricket'].facilityCount, 2);
    assert.equal(sports['Cricket'].facilityType, 'Grounds');
  });

  // 4. Edit existing configuration and verify persistence
  await t.test('4. Edit existing configuration: update court count and add categories', async () => {
    const res = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: multiSportEventId,
        name: 'Olympics Campus Games 2026 (Updated)',
        eventDate: '2026-12-15',
        venue: 'National Sports Arena - East Wing',
        configuration: {
          sports: {
            Badminton: {
              enabled: true,
              facilityType: 'Courts',
              facilityUnit: 'Court',
              facilityCount: 8, // Changed from 6 to 8
              categories: ["Men's Singles", "Women's Singles", "Open Doubles"] // Added Open Doubles
            },
            'Table Tennis': {
              enabled: true,
              facilityType: 'Tables',
              facilityUnit: 'Table',
              facilityCount: 5, // Changed from 4 to 5
              categories: ["Men's Singles", "Women's Singles", "Mixed Doubles"]
            }
          }
        }
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    // Re-query database
    const checkRes = await fetch(`${baseUrl}/api/admin/event/config?eventId=${multiSportEventId}`);
    const checkData = await checkRes.json();

    assert.equal(checkData.event.name, 'Olympics Campus Games 2026 (Updated)');
    assert.equal(checkData.event.event_date, '2026-12-15');
    assert.equal(checkData.event.venue, 'National Sports Arena - East Wing');

    const updatedBadminton = checkData.configuration.sports['Badminton'];
    assert.equal(updatedBadminton.facilityCount, 8);
    assert.deepEqual(updatedBadminton.categories, ["Men's Singles", "Women's Singles", "Open Doubles"]);

    const updatedTT = checkData.configuration.sports['Table Tennis'];
    assert.equal(updatedTT.facilityCount, 5);
  });
});
