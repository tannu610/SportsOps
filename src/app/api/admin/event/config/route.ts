import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { DEFAULT_SPORTS_CONFIG, EventConfiguration } from '@/utils/eventConfig';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: events, error } = await supabase.from('events').select('*').limit(1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!events || events.length === 0) {
      return NextResponse.json({
        event: null,
        configuration: { sports: DEFAULT_SPORTS_CONFIG }
      });
    }

    const event = events[0];
    let config: EventConfiguration = { sports: DEFAULT_SPORTS_CONFIG };

    // Check if configuration exists in event.configuration column
    if (event.configuration && typeof event.configuration === 'object' && event.configuration.sports) {
      config = event.configuration as EventConfiguration;
    } else if (event.sport && event.sport.startsWith('{')) {
      // Fallback: Check if JSON is serialized in sport column
      try {
        const parsed = JSON.parse(event.sport);
        if (parsed.sports) {
          config = parsed;
        }
      } catch {
        // Not a JSON string, keep default
      }
    }

    return NextResponse.json({
      event: {
        id: event.id,
        name: event.name || "Annual Sports Day 2026",
        event_date: event.event_date || "",
        venue: event.venue || "Main Sports Complex",
        created_at: event.created_at
      },
      configuration: config
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const { eventId, name, eventDate, venue, configuration } = body;

    if (!name) {
      return NextResponse.json({ error: 'Event Name is required' }, { status: 400 });
    }

    // Determine enabled sports summary text (e.g. "Badminton, Table Tennis")
    const sportsObj = configuration?.sports || DEFAULT_SPORTS_CONFIG;
    const enabledSports = Object.entries(sportsObj)
      .filter(([_, cfg]: [string, any]) => cfg.enabled)
      .map(([name]) => name);

    const sportSummary = enabledSports.length > 0 ? enabledSports.join(', ') : 'All Sports';

    // 1. Try updating with the configuration JSONB column
    const { data: updatedWithCol, error: colError } = await supabase
      .from('events')
      .update({
        name,
        venue,
        event_date: eventDate || null,
        configuration,
        sport: sportSummary
      })
      .eq('id', eventId)
      .select();

    // 2. If configuration column doesn't exist yet in DB, fallback to JSON in sport column
    if (colError && (colError.code === '42703' || colError.code === 'PGRST204' || colError.message?.includes('configuration'))) {
      const fallbackPayload = JSON.stringify(configuration);
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('events')
        .update({
          name,
          venue,
          event_date: eventDate || null,
          sport: fallbackPayload
        })
        .eq('id', eventId)
        .select();

      if (fallbackError) {
        return NextResponse.json({ error: fallbackError.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        event: fallbackData?.[0],
        configuration
      });
    } else if (colError) {
      return NextResponse.json({ error: colError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      event: updatedWithCol?.[0],
      configuration
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
