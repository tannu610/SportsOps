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
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !secretKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, secretKey);

test('ADMIN OVERVIEW: Total Matches Played Dashboard Statistic', async (t) => {
  const testSuffix = Date.now();
  const createdPlayerIds = [];
  const createdMatchIds = [];

  // 1. Ensure baseline event exists
  let { data: events } = await supabase.from('events').select('id, name').limit(1);
  if (!events || events.length === 0) {
    const { data: newEv } = await supabase.from('events').insert({
      name: `Dashboard Stats Event ${testSuffix}`,
      sport: 'Badminton',
      event_date: '2026-09-01',
      venue: 'Main Arena'
    }).select();
    events = newEv;
  }
  const eventId = events[0].id;

  // Helper to query current dashboard stats function
  async function computeCompletedMatches(eId) {
    let matchesQuery = supabase.from('matches').select('status');
    if (eId) {
      matchesQuery = matchesQuery.or(`event_id.eq.${eId},event_id.is.null`);
    }
    const { data: matches, error } = await matchesQuery;
    assert.ifError(error);
    const completed = matches ? matches.filter((m) => m.status === 'COMPLETED').length : 0;
    return completed;
  }

  // Create test players
  async function createPlayer(name, empCode) {
    const { data, error } = await supabase
      .from('players')
      .insert([
        {
          event_id: eventId,
          name,
          employee_id: empCode,
          sport: 'Badminton',
          category: "Men's Singles",
          status: 'PRESENT'
        }
      ])
      .select()
      .single();
    assert.ifError(error);
    createdPlayerIds.push(data.id);
    return data;
  }

  const p1 = await createPlayer(`Player A ${testSuffix}`, `EMP_STA_${testSuffix}_1`);
  const p2 = await createPlayer(`Player B ${testSuffix}`, `EMP_STB_${testSuffix}_2`);
  const p3 = await createPlayer(`Player C ${testSuffix}`, `EMP_STC_${testSuffix}_3`);
  const p4 = await createPlayer(`Player D ${testSuffix}`, `EMP_STD_${testSuffix}_4`);

  t.after(async () => {
    // Cleanup test matches and players
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
  });

  // Step 1: Record initial completed count
  const initialCompletedCount = await computeCompletedMatches(eventId);
  assert.ok(typeof initialCompletedCount === 'number');

  // Step 2: Create a SCHEDULED match and verify it is NOT counted
  const { data: mScheduled, error: schErr } = await supabase
    .from('matches')
    .insert([
      {
        event_id: eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playing_area: 'Court 1',
        scheduled_time: new Date(Date.now() + 30 * 60000).toISOString(),
        team1_p1_id: p1.id,
        team2_p1_id: p2.id,
        status: 'SCHEDULED'
      }
    ])
    .select()
    .single();
  assert.ifError(schErr);
  createdMatchIds.push(mScheduled.id);

  const countAfterScheduled = await computeCompletedMatches(eventId);
  assert.strictEqual(
    countAfterScheduled,
    initialCompletedCount,
    'SCHEDULED match should not increase Total Matches Played'
  );

  // Step 3: Create a LIVE match and verify it is NOT counted
  const { data: mLive, error: liveErr } = await supabase
    .from('matches')
    .insert([
      {
        event_id: eventId,
        sport: 'Badminton',
        category: "Men's Singles",
        phase: 'Round 1',
        playing_area: 'Court 2',
        scheduled_time: new Date(Date.now() + 60 * 60000).toISOString(),
        team1_p1_id: p3.id,
        team2_p1_id: p4.id,
        status: 'LIVE'
      }
    ])
    .select()
    .single();
  assert.ifError(liveErr);
  createdMatchIds.push(mLive.id);

  const countAfterLive = await computeCompletedMatches(eventId);
  assert.strictEqual(
    countAfterLive,
    initialCompletedCount,
    'LIVE match should not increase Total Matches Played'
  );

  // Step 4: Realtime subscription listener receives notification on status change to COMPLETED
  let realtimeTriggered = false;
  const channel = supabase
    .channel(`test-admin-stats-${testSuffix}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'matches' },
      (payload) => {
        if (payload.new && payload.new.id === mLive.id && payload.new.status === 'COMPLETED') {
          realtimeTriggered = true;
        }
      }
    )
    .subscribe();

  // Wait for subscription to become active
  await new Promise((res) => setTimeout(res, 500));

  // Update LIVE match to COMPLETED
  const { error: updateErr } = await supabase
    .from('matches')
    .update({ status: 'COMPLETED' })
    .eq('id', mLive.id);
  assert.ifError(updateErr);

  // Wait up to 3 seconds for realtime broadcast
  const startWait = Date.now();
  while (!realtimeTriggered && Date.now() - startWait < 3000) {
    await new Promise((res) => setTimeout(res, 100));
  }
  await supabase.removeChannel(channel);

  assert.ok(realtimeTriggered, 'Supabase Realtime should notify on matches status update to COMPLETED');

  // Step 5: Verify Total Matches Played incremented by exactly 1
  const countAfterComplete1 = await computeCompletedMatches(eventId);
  assert.strictEqual(
    countAfterComplete1,
    initialCompletedCount + 1,
    'Total Matches Played must increment by 1 when a match changes to COMPLETED'
  );

  // Step 6: Mark the scheduled match as COMPLETED as well
  const { error: updateSchErr } = await supabase
    .from('matches')
    .update({ status: 'COMPLETED' })
    .eq('id', mScheduled.id);
  assert.ifError(updateSchErr);

  const countAfterComplete2 = await computeCompletedMatches(eventId);
  assert.strictEqual(
    countAfterComplete2,
    initialCompletedCount + 2,
    'Total Matches Played must reflect both completed matches'
  );

  // Step 7: Verify count remains consistent after page refresh (re-query)
  const countAfterRefresh = await computeCompletedMatches(eventId);
  assert.strictEqual(
    countAfterRefresh,
    countAfterComplete2,
    'Total Matches Played must persist and remain correct across refreshes'
  );

  await supabase.removeAllChannels();
});
