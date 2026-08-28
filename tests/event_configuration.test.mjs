import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length > 0) {
        let val = rest.join('=').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
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

test('EVENT CONFIGURATION: Dynamic sports, categories, and facility allocations', async (t) => {
  // 1. Fetch current active event
  const { data: events } = await supabase.from('events').select('id, name').limit(1);
  assert.ok(events && events.length > 0, 'An event must exist');
  const eventId = events[0].id;

  // Test 1: GET /api/admin/event/config returns event details and default configuration
  await t.test('1. GET /api/admin/event/config returns current configuration', async () => {
    const res = await fetch(`${baseUrl}/api/admin/event/config`);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.ok(data.event, 'Event must be returned');
    assert.ok(data.configuration?.sports, 'Sports configuration must be present');
  });

  // Test 2: POST /api/admin/event/config saves multi-sport and facility configuration
  await t.test('2. Save multi-sport, facility, and category configuration', async () => {
    const testConfig = {
      sports: {
        "Badminton": {
          enabled: true,
          facilityType: "Courts",
          facilityUnit: "Court",
          facilityCount: 6,
          categories: [
            "Men's Singles",
            "Women's Singles",
            "Men's Doubles",
            "Women's Doubles",
            "Mixed Doubles"
          ]
        },
        "Table Tennis": {
          enabled: true,
          facilityType: "Tables",
          facilityUnit: "Table",
          facilityCount: 4,
          categories: [
            "Men's Singles",
            "Women's Singles",
            "Men's Doubles",
            "Women's Doubles",
            "Mixed Doubles"
          ]
        },
        "Cricket": {
          enabled: false,
          facilityType: "Grounds",
          facilityUnit: "Ground",
          facilityCount: 2,
          categories: ["Open", "Box Cricket"]
        }
      }
    };

    const res = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        name: "Sports Day Championship 2026",
        eventDate: "2026-09-15",
        venue: "Olympic Training Complex",
        configuration: testConfig
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200, `Saving failed: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);

    // Verify re-fetch returns the newly saved settings
    const checkRes = await fetch(`${baseUrl}/api/admin/event/config`);
    const checkData = await checkRes.json();

    assert.equal(checkData.event.name, "Sports Day Championship 2026");
    assert.equal(checkData.event.venue, "Olympic Training Complex");
    assert.equal(checkData.event.event_date, "2026-09-15");

    const badminton = checkData.configuration.sports["Badminton"];
    assert.equal(badminton.enabled, true);
    assert.equal(badminton.facilityType, "Courts");
    assert.equal(badminton.facilityCount, 6);
    assert.equal(badminton.categories.length, 5);

    const tt = checkData.configuration.sports["Table Tennis"];
    assert.equal(tt.enabled, true);
    assert.equal(tt.facilityType, "Tables");
    assert.equal(tt.facilityCount, 4);
    assert.equal(tt.categories.length, 5);
  });

  // Test 3: Admin can edit configuration later (e.g. change facility count or add sports)
  await t.test('3. Edit configuration later: change court count and enable Volleyball', async () => {
    const updatedConfig = {
      sports: {
        "Badminton": {
          enabled: true,
          facilityType: "Courts",
          facilityUnit: "Court",
          facilityCount: 8, // Changed from 6 to 8 courts
          categories: ["Men's Singles", "Women's Singles", "Open Doubles"]
        },
        "Volleyball": {
          enabled: true, // Enabled Volleyball
          facilityType: "Courts",
          facilityUnit: "Court",
          facilityCount: 3,
          categories: ["Open Tournament"]
        }
      }
    };

    const res = await fetch(`${baseUrl}/api/admin/event/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        name: "Sports Day Championship 2026 (Updated)",
        eventDate: "2026-09-20",
        venue: "National Indoor Stadium",
        configuration: updatedConfig
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    const checkRes = await fetch(`${baseUrl}/api/admin/event/config`);
    const checkData = await checkRes.json();

    assert.equal(checkData.event.name, "Sports Day Championship 2026 (Updated)");
    assert.equal(checkData.configuration.sports["Badminton"].facilityCount, 8);
    assert.equal(checkData.configuration.sports["Volleyball"].enabled, true);
    assert.equal(checkData.configuration.sports["Volleyball"].facilityCount, 3);
  });
});
