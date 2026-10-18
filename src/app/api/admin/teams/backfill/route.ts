import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { extractPlayerTeam } from '@/utils/teamUtils';
import { extractPlayerCode } from '@/utils/playerCode';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json().catch(() => ({}));
    const { eventId: requestedEventId } = body;

    // 1. Get current Cricket event if not specified
    let targetEventId = requestedEventId;
    if (!targetEventId) {
      const { data: events } = await supabase
        .from('events')
        .select('id, name')
        .order('created_at', { ascending: false });

      const cricketEvent = (events || []).find((e: any) =>
        e.name?.toLowerCase().includes('cricket') || e.name?.toLowerCase().includes('sports day')
      );
      targetEventId = cricketEvent?.id || events?.[0]?.id;
    }

    if (!targetEventId) {
      return NextResponse.json({ error: 'No event found to backfill' }, { status: 400 });
    }

    // 2. Fetch all players for this event
    const { data: players, error: pErr } = await supabase
      .from('players')
      .select('*')
      .eq('event_id', targetEventId);

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 });
    }

    const cricketPlayers = (players || []).filter((p: any) => {
      const t = extractPlayerTeam(p);
      return Boolean(t);
    });

    // Group players by team name
    const teamGroups = new Map<string, any[]>();
    const teamCaptains = new Map<string, string>(); // teamName -> captainPlayerId

    cricketPlayers.forEach((p: any) => {
      const t = extractPlayerTeam(p);
      if (!t) return;
      if (!teamGroups.has(t)) {
        teamGroups.set(t, []);
      }
      teamGroups.get(t)!.push(p);

      const isCap = p.push_subscription?._metadata?.is_captain === true;
      if (isCap) {
        teamCaptains.set(t, p.id);
      }
    });

    const teamsCreatedOrFound: any[] = [];
    let updatedPlayersCount = 0;

    // Check if teams table exists
    const { data: probe, error: probeErr } = await supabase
      .from('teams')
      .select('id')
      .limit(1);

    const hasTeamsTable = !probeErr;

    if (hasTeamsTable) {
      for (const [teamName, members] of teamGroups.entries()) {
        const captainId = teamCaptains.get(teamName) || members[0]?.id || null;

        // Find or insert into teams table
        const { data: existingTeam } = await supabase
          .from('teams')
          .select('id, name, captain_player_id')
          .eq('event_id', targetEventId)
          .eq('sport', 'Cricket')
          .eq('name', teamName)
          .maybeSingle();

        let teamId = existingTeam?.id;

        if (!teamId) {
          const { data: insTeam, error: insErr } = await supabase
            .from('teams')
            .insert({
              event_id: targetEventId,
              sport: 'Cricket',
              name: teamName,
              category: members[0]?.category || 'Open Cricket',
              captain_player_id: captainId
            })
            .select('id, name, captain_player_id')
            .single();

          if (!insErr && insTeam) {
            teamId = insTeam.id;
          }
        } else if (captainId && existingTeam?.captain_player_id !== captainId) {
          await supabase
            .from('teams')
            .update({ captain_player_id: captainId, updated_at: new Date().toISOString() })
            .eq('id', teamId);
        }

        if (teamId) {
          teamsCreatedOrFound.push({
            id: teamId,
            name: teamName,
            captainPlayerId: captainId,
            playerCount: members.length
          });

          // Link player records with team_id
          const unlinkedIds = members.filter((p: any) => p.team_id !== teamId).map((p: any) => p.id);
          if (unlinkedIds.length > 0) {
            const { error: linkErr } = await supabase
              .from('players')
              .update({ team_id: teamId })
              .in('id', unlinkedIds);

            if (!linkErr) {
              updatedPlayersCount += unlinkedIds.length;
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      eventId: targetEventId,
      hasTeamsTable,
      teamsDetected: Array.from(teamGroups.keys()),
      totalCricketPlayers: cricketPlayers.length,
      teamsSummary: Array.from(teamGroups.entries()).map(([name, mems]) => ({
        name,
        playerCount: mems.length,
        captainId: teamCaptains.get(name) || null,
        captainName: mems.find((p: any) => p.id === teamCaptains.get(name))?.name || mems[0]?.name
      })),
      relationalBackfill: hasTeamsTable
        ? {
            teamsProcessed: teamsCreatedOrFound.length,
            playersLinked: updatedPlayersCount
          }
        : 'teams table not present in Supabase schema yet; fallback active'
    });
  } catch (err: any) {
    console.error('Error during teams backfill:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
