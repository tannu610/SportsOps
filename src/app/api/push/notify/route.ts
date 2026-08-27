import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendPushNotification } from '@/utils/push'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    
    // Ensure the caller is an admin (user session exists)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { matchId } = await req.json()
    
    // Fetch match details and players
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select(`
        id, sport, category, playing_area,
        team1_p1:players!fk_t1p1(id, push_subscription),
        team1_p2:players!fk_t1p2(id, push_subscription),
        team2_p1:players!fk_t2p1(id, push_subscription),
        team2_p2:players!fk_t2p2(id, push_subscription)
      `)
      .eq('id', matchId)
      .single()

    if (matchError || !match) throw new Error('Match not found')

    // Collect all valid subscriptions
    const subscriptions: any[] = []
    const players = [match.team1_p1, match.team1_p2, match.team2_p1, match.team2_p2].filter(Boolean)
    
    players.forEach((p: any) => {
      if (p.push_subscription) subscriptions.push(p.push_subscription)
    })

    if (subscriptions.length === 0) {
      return NextResponse.json({ message: 'No players have push notifications enabled for this match.' })
    }

    const payload = JSON.stringify({
      title: 'Time for your match!',
      body: `Your ${match.sport} match is starting soon at ${match.playing_area}. Please report immediately.`,
      url: `/player/dashboard`
    })

    // Send push to all subscribed players
    const pushPromises = subscriptions.map(sub => sendPushNotification(sub, payload))
    await Promise.all(pushPromises)
    
    // Optional: Update match status to NOTIFIED
    await supabase.from('matches').update({ status: 'NOTIFIED' }).eq('id', matchId)

    return NextResponse.json({ success: true, count: subscriptions.length })
  } catch (err: any) {
    console.error('Push notify error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
