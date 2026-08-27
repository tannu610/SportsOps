import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { subscription, playerId } = await req.json()
    
    // Save subscription to the database for this player
    const { error } = await supabase
      .from('players')
      .update({ push_subscription: subscription })
      .eq('id', playerId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
