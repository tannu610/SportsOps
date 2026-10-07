import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { subscription, playerId } = await req.json()

    if (!playerId) {
      return NextResponse.json({ error: 'Player ID is required' }, { status: 400 })
    }

    // 1. Fetch existing player record to preserve _metadata (source, player_code, gender, etc.)
    const { data: existingPlayer } = await supabase
      .from('players')
      .select('push_subscription')
      .eq('id', playerId)
      .single()

    const existingMetadata = existingPlayer?.push_subscription?._metadata || {}
    const incomingMetadata = subscription?._metadata || {}
    const mergedSubscription = {
      ...(subscription || {}),
      _metadata: {
        ...existingMetadata,
        ...incomingMetadata
      }
    }

    // 2. Save merged subscription preserving persistent metadata
    const { error } = await supabase
      .from('players')
      .update({ push_subscription: mergedSubscription })
      .eq('id', playerId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
