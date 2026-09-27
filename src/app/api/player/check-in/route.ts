import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { verifyCheckInToken } from '@/utils/checkInToken';
import { extractPlayerCode, generatePlayerCode } from '@/utils/playerCode';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    const { token, player_id, employee_id, mobile_no } = body;

    let targetPlayerId: string | null = null;
    let verifiedEmpId: string | null = null;
    let verifiedPlayerCode: string | null = null;

    if (token) {
      // 1. Secure token-based automatic check-in (Walk-in players)
      const verified = verifyCheckInToken(token);
      if (!verified) {
        return NextResponse.json({
          error: 'Invalid or expired check-in token. Please check in manually.'
        }, { status: 401 });
      }

      // If client also supplied player_id, ensure it strictly matches the signed token
      if (player_id && player_id !== verified.playerId) {
        return NextResponse.json({
          error: 'Security verification failed: Player ID mismatch.'
        }, { status: 403 });
      }

      targetPlayerId = verified.playerId;
      verifiedEmpId = verified.employeeId;
      verifiedPlayerCode = verified.playerCode;
    } else if (employee_id) {
      // 2. Standard manual check-in verification
      const cleanEmp = String(employee_id).trim().toUpperCase();
      const { data: foundPlayers } = await supabase
        .from('players')
        .select('id, employee_id, status, contact_info, push_subscription')
        .ilike('employee_id', cleanEmp)
        .limit(1);

      if (!foundPlayers || foundPlayers.length === 0) {
        return NextResponse.json({
          error: 'Employee ID not found. Please contact the committee to get registered.'
        }, { status: 404 });
      }

      const foundPlayer = foundPlayers[0];

      // If mobile number is provided, verify match when contact_info exists
      if (mobile_no && foundPlayer.contact_info) {
        const inputDigits = String(mobile_no).replace(/\D/g, '');
        const savedDigits = String(foundPlayer.contact_info).replace(/\D/g, '');
        if (inputDigits && savedDigits && !savedDigits.endsWith(inputDigits) && !inputDigits.endsWith(savedDigits)) {
          return NextResponse.json({
            error: 'Mobile number does not match registered contact number.'
          }, { status: 401 });
        }
      }

      targetPlayerId = foundPlayer.id;
    } else {
      return NextResponse.json({
        error: 'Missing check-in token or employee ID.'
      }, { status: 400 });
    }

    // 3. Fetch player record from Supabase using base columns to ensure schema-cache compatibility
    const { data: player, error: fetchErr } = await supabase
      .from('players')
      .select('id, employee_id, name, sport, category, status, contact_info, check_in_time, push_subscription')
      .eq('id', targetPlayerId)
      .single();

    if (fetchErr || !player) {
      return NextResponse.json({
        error: 'Player not found in database.'
      }, { status: 404 });
    }

    // If verified token was used, ensure employee_id matches database
    if (verifiedEmpId && player.employee_id.toUpperCase() !== verifiedEmpId) {
      return NextResponse.json({
        error: 'Security verification failed: Player record mismatch.'
      }, { status: 403 });
    }

    let playerCode = extractPlayerCode(player) || verifiedPlayerCode;

    if (!playerCode) {
      playerCode = generatePlayerCode();
      const meta = player.push_subscription?._metadata || {};
      const updatedMeta = { ...meta, player_code: playerCode };
      const updatedPush = { ...(player.push_subscription || {}), _metadata: updatedMeta };
      const { error: upErr } = await supabase
        .from('players')
        .update({ player_code: playerCode, push_subscription: updatedPush })
        .eq('id', player.id);
      if (upErr && (upErr.code === 'PGRST204' || upErr.code === '42703' || upErr.message?.includes('column'))) {
        await supabase
          .from('players')
          .update({ push_subscription: updatedPush })
          .eq('id', player.id);
      }
    }

    // 4. Idempotency Check (Section 5)
    // If player is already PRESENT or in a post-checkin state (AVAILABLE, PLAYING),
    // treat as idempotent success without overwriting check_in_time or corrupting status.
    if (player.status === 'PRESENT' || player.status === 'AVAILABLE' || player.status === 'PLAYING') {
      return NextResponse.json({
        success: true,
        message: 'Player already checked in.',
        player: {
          id: player.id,
          employee_id: player.employee_id,
          name: player.name,
          player_code: playerCode,
          sport: player.sport,
          status: player.status,
          check_in_time: player.check_in_time
        }
      }, { status: 200 });
    }

    // 5. Update player status: REGISTERED / ABSENT -> PRESENT
    const nowIso = new Date().toISOString();
    const updatePayload: any = {
      status: 'PRESENT',
      check_in_time: player.check_in_time || nowIso
    };

    if (mobile_no && !player.contact_info) {
      updatePayload.contact_info = String(mobile_no).trim();
    }

    const { data: updatedPlayer, error: updateErr } = await supabase
      .from('players')
      .update(updatePayload)
      .eq('id', player.id)
      .select('id, employee_id, name, sport, category, status, check_in_time, push_subscription')
      .single();

    if (updateErr) {
      console.error('Check-in update error:', updateErr);
      return NextResponse.json({
        error: `Check-in failed: ${updateErr.message}`
      }, { status: 500 });
    }

    const updatedCode = extractPlayerCode(updatedPlayer) || playerCode;

    return NextResponse.json({
      success: true,
      message: 'Check-in successful',
      player: {
        id: updatedPlayer.id,
        employee_id: updatedPlayer.employee_id,
        name: updatedPlayer.name,
        player_code: updatedCode,
        sport: updatedPlayer.sport,
        status: updatedPlayer.status,
        check_in_time: updatedPlayer.check_in_time
      }
    }, { status: 200 });
  } catch (err: any) {
    console.error('Check-in route error:', err);
    return NextResponse.json({
      error: err.message || 'Internal Server Error'
    }, { status: 500 });
  }
}
