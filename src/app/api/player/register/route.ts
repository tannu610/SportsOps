import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generatePlayerCode } from '@/utils/playerCode';
import { isCategoryApplicableToGender } from '@/utils/eventConfig';
import { generateCheckInToken } from '@/utils/checkInToken';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const {
      employee_id,
      name,
      gender,
      contact_info,
      sport,
      categories,
      email,
      transport_required
    } = body;

    // 1. Validate required fields server-side
    if (!employee_id || !String(employee_id).trim()) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }
    const cleanEmpId = String(employee_id).trim().toUpperCase();

    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: 'Full Name is required' }, { status: 400 });
    }
    const cleanName = String(name).trim();

    const VALID_GENDERS = ['Male', 'Female'];
    if (!gender || !VALID_GENDERS.includes(gender)) {
      return NextResponse.json({
        error: 'Gender is required and must be either Male or Female'
      }, { status: 400 });
    }

    if (!contact_info || !String(contact_info).trim()) {
      return NextResponse.json({ error: 'Mobile / Contact Number is required' }, { status: 400 });
    }
    const cleanContact = String(contact_info).trim();
    const digitsOnly = cleanContact.replace(/\D/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      return NextResponse.json({ error: 'Please enter a valid mobile / contact number' }, { status: 400 });
    }

    if (!sport || !String(sport).trim()) {
      return NextResponse.json({ error: 'Sport is required' }, { status: 400 });
    }
    const cleanSport = String(sport).trim();

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      return NextResponse.json({ error: 'At least one category is required' }, { status: 400 });
    }
    const cleanCategories = categories.map((c: any) => String(c).trim()).filter(Boolean);
    if (cleanCategories.length === 0) {
      return NextResponse.json({ error: 'At least one category is required' }, { status: 400 });
    }

    // Validate optional email
    if (email && String(email).trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(email).trim())) {
        return NextResponse.json({ error: 'Invalid email address format' }, { status: 400 });
      }
    }
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const isTransport = transport_required === true || transport_required === 'Yes';

    // 2. Fetch active event (or use eventId from body if provided)
    let eventId = body.eventId;
    let eventConfigFromEvent = null;

    if (eventId) {
      const { data: evData } = await supabase.from('events').select('id, name, configuration').eq('id', eventId).single();
      if (evData) {
        eventConfigFromEvent = evData.configuration;
      }
    } else {
      const { data: events } = await supabase
        .from('events')
        .select('id, name, configuration')
        .order('created_at', { ascending: false })
        .limit(1);

      eventId = events?.[0]?.id;
      eventConfigFromEvent = events?.[0]?.configuration;
    }

    if (!eventId) {
      const { data: defaultEv } = await supabase.from('events').select('id, configuration').limit(1);
      eventId = defaultEv?.[0]?.id;
      eventConfigFromEvent = defaultEv?.[0]?.configuration;
    }

    if (!eventId) {
      return NextResponse.json({ error: 'No active event found. Please contact the committee.' }, { status: 400 });
    }

    // 3. Validate Sport and Categories against Event Configuration
    let validSportCategories: string[] | null = null;
    const { data: relSports } = await supabase
      .from('event_sports')
      .select('id, sport, event_categories(category)')
      .eq('event_id', eventId);

    if (relSports && relSports.length > 0) {
      const matchingRelSport = relSports.find((s: any) => s.sport.toLowerCase() === cleanSport.toLowerCase());
      if (!matchingRelSport) {
        return NextResponse.json({
          error: `Sport "${cleanSport}" is not configured for today's event`
        }, { status: 400 });
      }
      validSportCategories = (matchingRelSport.event_categories || []).map((c: any) => c.category);
    } else {
      const eventCfg = eventConfigFromEvent?.sports;
      if (!eventCfg || typeof eventCfg !== 'object') {
        return NextResponse.json({
          error: 'No sports are currently configured for this event.'
        }, { status: 400 });
      }

      const enabledSports = Object.entries(eventCfg).filter(([_, cfg]: [string, any]) => cfg?.enabled);
      if (enabledSports.length === 0) {
        return NextResponse.json({
          error: 'No sports are currently configured for this event.'
        }, { status: 400 });
      }

      const matchingKey = Object.keys(eventCfg).find((k) => k.toLowerCase() === cleanSport.toLowerCase());
      const configuredSport = matchingKey ? eventCfg[matchingKey] : null;
      if (!configuredSport || configuredSport.enabled === false) {
        return NextResponse.json({
          error: `Sport "${cleanSport}" is not configured for today's event`
        }, { status: 400 });
      }
      validSportCategories = configuredSport.categories || [];
    }

    if (!validSportCategories || validSportCategories.length === 0) {
      return NextResponse.json({
        error: `No categories configured for ${cleanSport}`
      }, { status: 400 });
    }

    for (const cat of cleanCategories) {
      const matches = validSportCategories.some((vc: string) => vc.toLowerCase() === cat.toLowerCase());
      if (!matches) {
        return NextResponse.json({
          error: `Category "${cat}" does not belong to configured categories for ${cleanSport}`
        }, { status: 400 });
      }

      if (!isCategoryApplicableToGender(cat, gender as 'Male' | 'Female')) {
        return NextResponse.json({
          error: `Category "${cat}" is not applicable for gender "${gender}"`
        }, { status: 400 });
      }
    }

    // 4. Duplicate Employee ID check (database-side)
    const { data: existingPlayers } = await supabase
      .from('players')
      .select('id, employee_id, name, status, push_subscription')
      .ilike('employee_id', cleanEmpId);

    if (existingPlayers && existingPlayers.length > 0) {
      const existing = existingPlayers[0];
      const existingCode = (existing as any).player_code || existing.push_subscription?._metadata?.player_code || null;
      return NextResponse.json({
        error: 'Already registered.',
        message: 'Please continue to Check In using your Employee ID and Player Code.',
        player: {
          employee_id: existing.employee_id,
          name: existing.name,
          player_code: existingCode
        }
      }, { status: 409 });
    }

    // 5. Generate Unique Persistent Player Code
    let playerCode = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generatePlayerCode();
      const { data: codeMatches, error: codeErr } = await supabase
        .from('players')
        .select('id')
        .eq('player_code', candidate)
        .limit(1);

      if (codeErr && (codeErr.code === 'PGRST204' || codeErr.message?.includes('column'))) {
        const { data: subMatches } = await supabase
          .from('players')
          .select('id, push_subscription')
          .limit(100);
        const collision = subMatches?.some((p: any) => p.push_subscription?._metadata?.player_code === candidate);
        if (!collision) {
          playerCode = candidate;
          break;
        }
      } else if (!codeMatches || codeMatches.length === 0) {
        playerCode = candidate;
        break;
      }
    }
    if (!playerCode) {
      playerCode = generatePlayerCode();
    }

    const categoryString = cleanCategories.join(', ');

    // 6. Insert new player with Source = 'WALK-IN', Status = 'REGISTERED'
    const fullPayload = {
      event_id: eventId,
      employee_id: cleanEmpId,
      name: cleanName,
      gender: gender,
      sport: cleanSport,
      category: categoryString,
      contact_info: cleanContact,
      email: cleanEmail,
      transport_required: isTransport,
      source: 'WALK-IN',
      player_code: playerCode,
      status: 'REGISTERED',
      current_round: 1,
      push_subscription: {
        _metadata: {
          player_code: playerCode,
          gender: gender,
          source: 'WALK-IN',
          email: cleanEmail,
          transport_required: isTransport
        }
      }
    };

    let insertedPlayer: any = null;

    // Try inserting with native columns
    const { data: insertData, error: insertErr } = await supabase
      .from('players')
      .insert([fullPayload])
      .select()
      .single();

    if (!insertErr && insertData) {
      insertedPlayer = insertData;
    } else if (
      insertErr &&
      (insertErr.code === 'PGRST204' || insertErr.code === '42703' || insertErr.message?.includes('column'))
    ) {
      // Graceful fallback if native columns not yet migrated in Supabase PostgREST cache
      const fallbackPayload = {
        event_id: eventId,
        employee_id: cleanEmpId,
        name: cleanName,
        sport: cleanSport,
        category: categoryString,
        contact_info: cleanContact,
        status: 'REGISTERED',
        current_round: 1,
        push_subscription: {
          _metadata: {
            player_code: playerCode,
            gender: gender,
            source: 'WALK-IN',
            email: cleanEmail,
            transport_required: isTransport
          }
        }
      };

      const { data: fbData, error: fbErr } = await supabase
        .from('players')
        .insert([fallbackPayload])
        .select()
        .single();

      if (fbErr) {
        if (fbErr.code === '23505' || fbErr.message?.includes('duplicate key') || fbErr.message?.includes('unique')) {
          return NextResponse.json({
            error: 'Already registered.',
            message: 'Please continue to Check In using your Employee ID and Player Code.'
          }, { status: 409 });
        }
        return NextResponse.json({ error: `Registration failed: ${fbErr.message}` }, { status: 500 });
      }
      insertedPlayer = fbData;
    } else if (insertErr) {
      if (insertErr.code === '23505' || insertErr.message?.includes('duplicate key') || insertErr.message?.includes('unique')) {
        return NextResponse.json({
          error: 'Already registered.',
          message: 'Please continue to Check In using your Employee ID and Player Code.'
        }, { status: 409 });
      }
      return NextResponse.json({ error: `Registration failed: ${insertErr.message}` }, { status: 500 });
    }

    const checkInToken = generateCheckInToken(insertedPlayer.id, playerCode, cleanEmpId);

    return NextResponse.json({
      success: true,
      player: {
        id: insertedPlayer.id,
        employee_id: cleanEmpId,
        name: cleanName,
        gender: gender,
        sport: cleanSport,
        category: categoryString,
        player_code: playerCode,
        source: 'WALK-IN',
        status: 'REGISTERED'
      },
      check_in_token: checkInToken
    }, { status: 201 });
  } catch (err: any) {
    console.error('Registration route error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
