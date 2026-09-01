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

test('BUG-001: Realtime player notifications without manual page refresh', async (t) => {
  // 1. Setup test fixture
  let { data: events } = await supabase.from('events').select('id').limit(1);
  if (!events || events.length === 0) {
    const { data: newEv } = await supabase.from('events').insert({
      name: 'Annual Sports Day Championship 2026',
      sport: 'Badminton',
      event_date: '2026-09-01',
      venue: 'Main Arena'
    }).select();
    events = newEv;
  }
  assert.ok(events && events.length > 0, 'An event must exist');
  const eventId = events[0].id;

  const testSuffix = Date.now();
  const createdPlayerIds = [];
  const createdMatchIds = [];

  // Helper to create test player
  async function createPlayer(name, empCode) {
    const { data, error } = await supabase.from('players').insert([{
      event_id: eventId,
      employee_id: `NOTIF_${empCode}_${testSuffix}`,
      name,
      sport: 'Badminton',
      category: 'Men Singles',
      status: 'PRESENT'
    }]).select().single();
    assert.ifError(error);
    createdPlayerIds.push(data.id);
    return data;
  }

  const p1 = await createPlayer('Realtime Player 1', 'P1');
  const p2 = await createPlayer('Realtime Player 2', 'P2');
  const p3 = await createPlayer('Realtime Player 3', 'P3');

  t.after(async () => {
    // Cleanup test notifications
    for (const pid of createdPlayerIds) {
      await supabase.from('notifications').delete().eq('player_id', pid);
    }
    // Cleanup test matches
    for (const matchId of createdMatchIds) {
      await supabase.from('matches').delete().eq('id', matchId);
    }
    // Cleanup test players
    for (const pid of createdPlayerIds) {
      await supabase.from('players').delete().eq('id', pid);
    }
  });

  // Setup client simulating player's open browser session
  const playerClient = createClient(supabaseUrl, anonKey);
  const p3Client = createClient(supabaseUrl, anonKey);
  const receivedBroadcasts = [];
  const p3ReceivedBroadcasts = [];

  const playerChannel = playerClient.channel(`player-notifications-${p1.id}`);
  playerChannel.on('broadcast', { event: 'new-notification' }, (payload) => {
    receivedBroadcasts.push(payload.payload);
  });

  const p3Channel = p3Client.channel(`player-notifications-${p3.id}`);
  p3Channel.on('broadcast', { event: 'new-notification' }, (payload) => {
    p3ReceivedBroadcasts.push(payload.payload);
  });

  await Promise.all([
    new Promise((resolve) => {
      playerChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve(true);
      });
    }),
    new Promise((resolve) => {
      p3Channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve(true);
      });
    }),
  ]);

  const slot1 = new Date('2026-08-29T11:00:00.000Z').toISOString();
  const slot2 = new Date('2026-08-29T15:00:00.000Z').toISOString();

  // Test 1: Admin creates match -> Player receives notification immediately in realtime
  await t.test('1. New notification appears immediately in real time without page refresh', async () => {
    const initialCount = receivedBroadcasts.length;

    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Quarter-Final',
        playingArea: 'Court 1',
        scheduledTime: slot1,
        team1_p1_id: p1.id,
        team2_p1_id: p2.id,
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200, `Match creation failed: ${JSON.stringify(data)}`);
    assert.ok(data.match?.id);
    createdMatchIds.push(data.match.id);

    // Wait for the realtime broadcast to arrive (typically < 300ms)
    await new Promise((r) => setTimeout(r, 1000));

    assert.equal(
      receivedBroadcasts.length,
      initialCount + 1,
      'Player client must receive realtime broadcast without manual refresh'
    );

    const latest = receivedBroadcasts[receivedBroadcasts.length - 1];
    assert.equal(latest.player_id, p1.id, 'Notification must target the correct player');
    assert.match(latest.message, /Badminton/i, 'Notification must include the sport');
    assert.match(latest.message, /Court 1/i, 'Notification must include the court');
    assert.equal(
      p3ReceivedBroadcasts.length,
      0,
      'Player 3 (not in match 1) must NOT receive Player 1 notification'
    );
  });

  // Test 2: Notification count and unread status update automatically
  await t.test('2. Notification count and unread status update automatically', async () => {
    const res = await fetch(`${baseUrl}/api/player/notifications?playerId=${p1.id}`);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.ok(data.notifications && data.notifications.length >= 1);
    assert.equal(data.unreadCount, 1, 'Unread count must be 1 for the first notification');
    assert.equal(data.notifications[0].read, false, 'New notification must be unread');
  });

  // Test 3: Multiple new notifications appear correctly while existing notifications remain intact
  await t.test('3. Multiple new notifications appear correctly while existing remain intact', async () => {
    const countBefore = receivedBroadcasts.length;
    const p3CountBefore = p3ReceivedBroadcasts.length;

    // Create a second match at a different time slot for p1 vs p3
    const res = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Semi-Final',
        playingArea: 'Court 2',
        scheduledTime: slot2,
        team1_p1_id: p1.id,
        team2_p1_id: p3.id,
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200, `Second match creation failed: ${JSON.stringify(data)}`);
    assert.ok(data.match?.id);
    createdMatchIds.push(data.match.id);

    // Wait for the second realtime broadcast to arrive
    await new Promise((r) => setTimeout(r, 1000));

    assert.equal(
      receivedBroadcasts.length,
      countBefore + 1,
      'Second realtime broadcast must be received without page refresh for player 1'
    );
    assert.equal(
      p3ReceivedBroadcasts.length,
      p3CountBefore + 1,
      'Player 3 must now receive their notification for match 2'
    );

    // Verify DB list and unread count
    const notifsRes = await fetch(`${baseUrl}/api/player/notifications?playerId=${p1.id}`);
    const notifsData = await notifsRes.json();

    assert.equal(notifsData.notifications.length, 2, 'Existing notification must remain intact (total: 2)');
    assert.equal(notifsData.unreadCount, 2, 'Unread count must increment to 2');
    assert.match(notifsData.notifications[0].message, /Court 2/i, 'Latest notification appears at top');
    assert.match(notifsData.notifications[1].message, /Court 1/i, 'First notification is preserved intact');
  });

  // Test 4: Marking notifications as read updates unread count
  await t.test('4. Marking notifications as read updates unread count', async () => {
    const markRes = await fetch(`${baseUrl}/api/player/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: p1.id,
        markAll: true
      })
    });
    const markData = await markRes.json();
    assert.equal(markRes.status, 200);
    assert.equal(markData.success, true);

    const checkRes = await fetch(`${baseUrl}/api/player/notifications?playerId=${p1.id}`);
    const checkData = await checkRes.json();

    assert.equal(checkData.unreadCount, 0, 'Unread count must be 0 after marking all as read');
    assert.equal(checkData.notifications.every((n) => n.read === true), true, 'All notifications must be marked read');
  });

  // Test 5: Realtime Dashboard Match & Notification Isolation (Anuj vs Rohit scenario)
  await t.test('5. Open dashboard reflects match creation & notification immediately with player isolation', async () => {
    // Simulate Anuj (p2) having dashboard open
    const anujClient = createClient(supabaseUrl, anonKey);
    const rohitClient = createClient(supabaseUrl, anonKey);
    let anujMatchEventReceived = 0;
    let rohitMatchEventReceived = 0;

    const anujChannel = anujClient.channel(`dashboard-test-${p2.id}`);
    anujChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
      const m = payload.new;
      if (m && (m.team1_p1_id === p2.id || m.team1_p2_id === p2.id || m.team2_p1_id === p2.id || m.team2_p2_id === p2.id)) {
        anujMatchEventReceived++;
      }
    });

    const rohitChannel = rohitClient.channel(`dashboard-test-${p3.id}`);
    rohitChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
      const m = payload.new;
      if (m && (m.team1_p1_id === p3.id || m.team1_p2_id === p3.id || m.team2_p1_id === p3.id || m.team2_p2_id === p3.id)) {
        rohitMatchEventReceived++;
      }
    });

    await Promise.all([
      new Promise((res) => anujChannel.subscribe((s) => s === 'SUBSCRIBED' && res(true))),
      new Promise((res) => rohitChannel.subscribe((s) => s === 'SUBSCRIBED' && res(true))),
    ]);

    const slot3 = new Date('2026-08-29T18:00:00.000Z').toISOString();

    // Admin creates match for Anuj (p2) vs Player 1 (p1)
    const createRes = await fetch(`${baseUrl}/api/matches/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        sport: 'Badminton',
        category: 'Men Singles',
        phase: 'Final',
        playingArea: 'Court 1',
        scheduledTime: slot3,
        team1_p1_id: p2.id,
        team2_p1_id: p1.id,
      })
    });

    const createData = await createRes.json();
    assert.equal(createRes.status, 200);
    assert.ok(createData.match?.id);
    createdMatchIds.push(createData.match.id);

    const startWait = Date.now();
    while (anujMatchEventReceived === 0 && Date.now() - startWait < 3000) {
      await new Promise((res) => setTimeout(res, 100));
    }

    // Verify Anuj received match update
    assert.ok(anujMatchEventReceived >= 1, 'Anuj must receive match event in realtime without page refresh');
    // Verify Player 3 (not in match) did NOT process this match
    assert.equal(rohitMatchEventReceived, 0, 'Player 3 must NOT receive match event for Anuj vs Player 1');

    // Query Anuj's dashboard state to verify active matches query includes this newly created match
    const { data: anujMatches } = await supabase
      .from('matches')
      .select('id, sport, playing_area, scheduled_time, status')
      .or(`team1_p1_id.eq.${p2.id},team1_p2_id.eq.${p2.id},team2_p1_id.eq.${p2.id},team2_p2_id.eq.${p2.id}`)
      .in('status', ['SCHEDULED', 'NOTIFIED', 'PLAYER_CONFIRMED', 'READY', 'LIVE', 'DELAYED', 'NO-SHOW PENDING', 'NO_SHOW_PENDING']);

    assert.ok(anujMatches && anujMatches.some((m) => m.id === createData.match.id), 'Newly created match must be present in Anuj active matches');

    await anujClient.removeAllChannels();
    await rohitClient.removeAllChannels();
  });

  await playerClient.removeAllChannels();
  await p3Client.removeAllChannels();
});
