import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { sendPushNotification } from '@/utils/push';
import { extractPlayerTeam } from '@/utils/teamUtils';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    
    // Ensure the caller is an admin (user session exists or auth header / dev environment)
    const { data: { user } } = await supabase.auth.getUser();
    const authHeader = req.headers.get('authorization');
    const isAuthorized = Boolean(
      user ||
      (authHeader && (authHeader.includes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'no_key') || authHeader.includes(process.env.SUPABASE_SECRET_KEY || 'no_key'))) ||
      process.env.NODE_ENV !== 'production'
    );
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { matchId } = await req.json();
    
    // Fetch match details and players
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select(`
        id, event_id, sport, category, playing_area, scheduled_time, score,
        team1_p1:players!fk_t1p1(id, name, push_subscription),
        team1_p2:players!fk_t1p2(id, name, push_subscription),
        team2_p1:players!fk_t2p1(id, name, push_subscription),
        team2_p2:players!fk_t2p2(id, name, push_subscription)
      `)
      .eq('id', matchId)
      .single();

    if (matchError || !match) throw new Error('Match not found');

    const rawPlayers = [match.team1_p1, match.team1_p2, match.team2_p1, match.team2_p2];
    let players: any[] = rawPlayers
      .flat()
      .filter((p: any): p is { id: string; name: string; push_subscription: any } => Boolean(p && p.id));

    // Check if team match (Cricket)
    let scoreMeta: any = {};
    try {
      if (typeof match.score === 'string' && match.score.startsWith('{')) {
        scoreMeta = JSON.parse(match.score);
      }
    } catch {}

    if (scoreMeta.is_team_match && (scoreMeta.team1_name || scoreMeta.team2_name)) {
      const { data: teamPlayers } = await supabase
        .from('players')
        .select('id, name, push_subscription')
        .eq('event_id', match.event_id);

      const allMatching = (teamPlayers || []).filter((p: any) => {
        const t = extractPlayerTeam(p);
        return t && (
          (scoreMeta.team1_name && t.toLowerCase() === scoreMeta.team1_name.toLowerCase()) ||
          (scoreMeta.team2_name && t.toLowerCase() === scoreMeta.team2_name.toLowerCase())
        );
      });

      if (allMatching.length > 0) {
        players = allMatching;
      }
    }

    const playerIds: string[] = players.map((p) => p.id);

    const matchName = scoreMeta.is_team_match && scoreMeta.team1_name && scoreMeta.team2_name
      ? `${scoreMeta.team1_name} vs ${scoreMeta.team2_name}`
      : match.sport;

    const messageText = `Your ${match.sport} match (${matchName}) at ${match.playing_area} is starting soon. Please report immediately.`;

    // 1. Fetch existing or create notification records in DB for all players
    const { data: existingNotifs } = await supabase
      .from('notifications')
      .select('*')
      .eq('match_id', match.id);

    let finalNotifs = existingNotifs || [];
    const missingPlayerIds = playerIds.filter(
      (pid) => !finalNotifs.some((n) => n.player_id === pid)
    );

    if (missingPlayerIds.length > 0) {
      const notificationInserts = missingPlayerIds.map((pid) => ({
        player_id: pid,
        match_id: match.id,
        type: 'MATCH_CALLED',
        message: messageText,
        read: false
      }));

      const { data: newlyInserted, error: notifErr } = await supabase
        .from('notifications')
        .insert(notificationInserts)
        .select();

      if (notifErr) {
        console.error('Error inserting notifications in push/notify:', notifErr);
      } else if (newlyInserted) {
        finalNotifs = [...finalNotifs, ...newlyInserted];
      }
    }

    // 2. Broadcast via Supabase Realtime channel for instant in-app update
    try {
      for (const pid of playerIds) {
        const notif = finalNotifs.find((n) => n.player_id === pid);
        const payload = notif || {
          id: `gen-${Date.now()}-${pid}`,
          player_id: pid,
          match_id: match.id,
          type: 'MATCH_CALLED',
          message: messageText,
          sent_at: new Date().toISOString(),
          read: false
        };

        const channel = supabase.channel(`player-notifications-${pid}`);
        await new Promise((resolve) => {
          channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              channel
                .send({
                  type: 'broadcast',
                  event: 'new-notification',
                  payload
                })
                .then(() => {
                  supabase.removeChannel(channel);
                  resolve(true);
                })
                .catch(() => {
                  supabase.removeChannel(channel);
                  resolve(false);
                });
            } else {
              supabase.removeChannel(channel);
              resolve(false);
            }
          });
          setTimeout(() => {
            supabase.removeChannel(channel);
            resolve(false);
          }, 800);
        });
      }
    } catch (broadcastErr) {
      console.error('Error broadcasting realtime notifications:', broadcastErr);
    }

    // 3. Update match status to NOTIFIED
    await supabase.from('matches').update({ status: 'NOTIFIED' }).eq('id', matchId);

    // 4. Send Web Push to subscribed devices (if any)
    const subscriptions: any[] = [];
    players.forEach((p: any) => {
      if (p.push_subscription) subscriptions.push(p.push_subscription);
    });

    if (subscriptions.length > 0) {
      const payload = JSON.stringify({
        title: 'Time for your match!',
        body: messageText,
        url: `/player/dashboard`
      });

      const pushPromises = subscriptions.map(sub => sendPushNotification(sub, payload));
      await Promise.all(pushPromises);
    }

    return NextResponse.json({
      success: true,
      count: playerIds.length,
      pushCount: subscriptions.length,
      notifications: finalNotifs
    });
  } catch (err: any) {
    console.error('Push notify error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
