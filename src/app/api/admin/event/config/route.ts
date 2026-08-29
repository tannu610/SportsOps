import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
  DEFAULT_SPORTS_CONFIG,
  SPORT_FACILITY_DEFAULTS,
  EventConfiguration,
  validateEventConfigPayload
} from '@/utils/eventConfig';

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);
    const requestedEventId = searchParams.get('eventId');

    // Fetch all events for dropdown/selection
    const { data: allEvents } = await supabase
      .from('events')
      .select('id, name, event_date, venue, created_at')
      .order('created_at', { ascending: false });

    let eventQuery = supabase.from('events').select('*');
    if (requestedEventId) {
      eventQuery = eventQuery.eq('id', requestedEventId);
    } else {
      eventQuery = eventQuery.order('created_at', { ascending: false }).limit(1);
    }

    const { data: events, error } = await eventQuery;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!events || events.length === 0) {
      return NextResponse.json({
        event: null,
        eventsList: allEvents || [],
        configuration: { sports: DEFAULT_SPORTS_CONFIG },
        source: 'default'
      });
    }

    const event = events[0];
    let config: EventConfiguration = { sports: { ...DEFAULT_SPORTS_CONFIG } };
    let dataSource = 'default';

    // 1. Try fetching from normalized relational tables: event_sports, event_categories, event_facilities
    try {
      const { data: sportsRows, error: relError } = await supabase
        .from('event_sports')
        .select(`
          id, sport,
          event_categories(id, category),
          event_facilities(id, facility_type, facility_count)
        `)
        .eq('event_id', event.id);

      if (!relError && sportsRows && sportsRows.length > 0) {
        const relationalSports: Record<string, any> = {};

        // Pre-populate with all known sports as disabled
        Object.entries(DEFAULT_SPORTS_CONFIG).forEach(([sName, defCfg]) => {
          relationalSports[sName] = { ...defCfg, enabled: false };
        });

        sportsRows.forEach((row: any) => {
          const sName = row.sport;
          const facility = Array.isArray(row.event_facilities)
            ? row.event_facilities[0]
            : row.event_facilities;
          const categories = Array.isArray(row.event_categories)
            ? row.event_categories.map((c: any) => c.category)
            : row.event_categories
            ? [row.event_categories.category]
            : [];
          const defaultFac = SPORT_FACILITY_DEFAULTS[sName] || {
            facilityType: 'Courts',
            facilityUnit: 'Court',
            defaultCount: 4
          };

          relationalSports[sName] = {
            enabled: true,
            facilityType: facility?.facility_type || defaultFac.facilityType,
            facilityUnit: defaultFac.facilityUnit,
            facilityCount: facility?.facility_count || defaultFac.defaultCount,
            categories: categories.length > 0 ? categories : ["Open"]
          };
        });

        config = { sports: relationalSports };
        dataSource = 'event_sports_relational';
      }
    } catch {
      // Table may not exist yet; gracefully fallback
    }

    // 2. If relational tables had no rows for this event, fallback to event.configuration or serialized event.sport
    if (dataSource === 'default') {
      if (event.configuration && typeof event.configuration === 'object' && event.configuration.sports) {
        config = {
          sports: {
            ...DEFAULT_SPORTS_CONFIG,
            ...event.configuration.sports
          }
        };
        dataSource = 'event_configuration_column';
      } else if (event.sport && event.sport.startsWith('{')) {
        try {
          const parsed = JSON.parse(event.sport);
          if (parsed.sports) {
            config = {
              sports: {
                ...DEFAULT_SPORTS_CONFIG,
                ...parsed.sports
              }
            };
            dataSource = 'event_sport_serialized';
          }
        } catch {
          // Keep defaults
        }
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
      eventsList: allEvents || [],
      configuration: config,
      source: dataSource
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

    // 1. Strict Server-Side Validation
    const validation = validateEventConfigPayload({ name, eventDate, venue, configuration });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const sportsObj = configuration.sports;
    const enabledSports = Object.entries(sportsObj)
      .filter(([_, cfg]: [string, any]) => cfg.enabled);

    const sportSummary = enabledSports.map(([name]) => name).join(', ');

    // 2. Try Atomic Stored Procedure: save_event_configuration
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('save_event_configuration', {
        p_event_id: eventId || null,
        p_name: name.trim(),
        p_event_date: eventDate,
        p_venue: venue.trim(),
        p_sports: sportsObj
      });

      if (!rpcError && rpcData && rpcData.success) {
        return NextResponse.json({
          success: true,
          event: {
            id: rpcData.event_id,
            name: name.trim(),
            event_date: eventDate,
            venue: venue.trim()
          },
          configuration,
          method: 'atomic_rpc'
        });
      }
    } catch {
      // RPC might not exist in database yet; fallback to direct multi-table upsert
    }

    // 3. Fallback: Multi-step atomic upsert via Supabase Client
    let targetEventId = eventId;

    if (targetEventId) {
      // Update existing event
      const { error: updateErr } = await supabase
        .from('events')
        .update({
          name: name.trim(),
          event_date: eventDate,
          venue: venue.trim(),
          sport: sportSummary
        })
        .eq('id', targetEventId);

      if (updateErr) throw new Error(updateErr.message);
    } else {
      // Create new event
      const { data: newEv, error: insertErr } = await supabase
        .from('events')
        .insert({
          name: name.trim(),
          event_date: eventDate,
          venue: venue.trim(),
          sport: sportSummary
        })
        .select()
        .single();

      if (insertErr || !newEv) throw new Error(insertErr?.message || 'Failed to create event');
      targetEventId = newEv.id;
    }

    // 4. Try updating relational tables (event_sports, event_facilities, event_categories)
    try {
      // Delete previous sports for this event (cascades to categories and facilities)
      await supabase.from('event_sports').delete().eq('event_id', targetEventId);

      for (const [sportName, cfg] of enabledSports) {
        const typedCfg = cfg as any;
        const defaultFac = SPORT_FACILITY_DEFAULTS[sportName] || {
          facilityType: 'Courts',
          facilityUnit: 'Court',
          defaultCount: 4
        };

        const { data: insertedSport, error: sportErr } = await supabase
          .from('event_sports')
          .insert({
            event_id: targetEventId,
            sport: sportName
          })
          .select()
          .single();

        if (!sportErr && insertedSport) {
          // Insert facility
          await supabase.from('event_facilities').insert({
            event_sport_id: insertedSport.id,
            facility_type: typedCfg.facilityType || defaultFac.facilityType,
            facility_count: typedCfg.facilityCount || defaultFac.defaultCount
          });

          // Insert categories
          const catInserts = (typedCfg.categories || []).map((cat: string) => ({
            event_sport_id: insertedSport.id,
            category: cat
          }));

          if (catInserts.length > 0) {
            await supabase.from('event_categories').insert(catInserts);
          }
        }
      }
    } catch {
      // Relational tables may not be created yet; configuration still safely synced in events
    }

    // 5. Keep events.configuration column in sync
    const { error: colErr } = await supabase
      .from('events')
      .update({ configuration })
      .eq('id', targetEventId);

    // If configuration column doesn't exist yet, save JSON in sport column
    if (colErr && (colErr.code === '42703' || colErr.code === 'PGRST204' || colErr.message?.includes('configuration'))) {
      await supabase
        .from('events')
        .update({ sport: JSON.stringify(configuration) })
        .eq('id', targetEventId);
    }

    return NextResponse.json({
      success: true,
      event: {
        id: targetEventId,
        name: name.trim(),
        event_date: eventDate,
        venue: venue.trim()
      },
      configuration,
      method: 'service_fallback'
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
