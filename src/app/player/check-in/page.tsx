"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Phone, ArrowRight } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

export default function CheckInPage() {
  const router = useRouter();
  const [empId, setEmpId] = useState("");
  const [mobileNo, setMobileNo] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  
  const supabase = createClient();

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empId || !mobileNo) return;
    
    setIsLoading(true);
    setError("");
    
    const searchId = empId.toUpperCase().trim();
    
    // 1. Check if player exists (by Employee ID or Player Code)
    let players: any[] | null = null;
    let searchErr: any = null;

    if (searchId.startsWith('SO-')) {
      const { data, error: err } = await supabase
        .from('players')
        .select('id, employee_id, status, contact_info')
        .or(`player_code.eq.${searchId},employee_id.eq.${searchId}`)
        .limit(1);
      players = data;
      searchErr = err;

      // Fallback if player_code column not in PostgREST schema cache yet
      if (searchErr && (searchErr.code === 'PGRST204' || searchErr.message?.includes('column'))) {
        const { data: allPlayers } = await supabase
          .from('players')
          .select('id, employee_id, status, contact_info, push_subscription');
        if (allPlayers) {
          players = allPlayers.filter((p: any) =>
            p.employee_id?.toUpperCase() === searchId ||
            p.push_subscription?._metadata?.player_code?.toUpperCase() === searchId
          );
          searchErr = null;
        }
      }
    } else {
      const { data, error: err } = await supabase
        .from('players')
        .select('id, employee_id, status, contact_info')
        .eq('employee_id', searchId)
        .limit(1);
      players = data;
      searchErr = err;
    }
      
    if (searchErr) {
      setError("Database error. Please try again.");
      setIsLoading(false);
      return;
    }
    
    if (!players || players.length === 0) {
      setError("Employee ID not found. Please contact the committee to get registered.");
      setIsLoading(false);
      return;
    }
    
    const player = players[0];
    
    // 2. Mark as PRESENT and optionally save their mobile number if it wasn't saved during import
    const updatePayload: any = {};
    if (player.status === 'REGISTERED' || player.status === 'ABSENT') {
      updatePayload.status = 'PRESENT';
      updatePayload.check_in_time = new Date().toISOString();
    }
    if (!player.contact_info) {
      updatePayload.contact_info = mobileNo;
    }

    if (Object.keys(updatePayload).length > 0) {
      const { data: updateData, error: updateErr } = await supabase
        .from('players')
        .update(updatePayload)
        .eq('id', player.id)
        .select();

      if (updateErr) {
        setError(`Check-in failed: ${updateErr.message}`);
        setIsLoading(false);
        return;
      }
      
      if (!updateData || updateData.length === 0) {
        setError(`Check-in failed: 0 rows updated. You might have Row Level Security enabled blocking updates.`);
        setIsLoading(false);
        return;
      }
    }
    
    // Save to localStorage for persistent session
    if (typeof window !== 'undefined') {
      localStorage.setItem('sports_player_id', player.id);
    }

    // Route to dashboard
    router.push(`/player/dashboard?id=${player.id}`);
  };

  return (
    <div className="p-6 h-full flex flex-col justify-center space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Player Check-In</h1>
        <p className="text-gray-500">Welcome to the venue! Please enter your details below to mark yourself as present.</p>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 space-y-6">
        <form onSubmit={handleCheckIn} className="space-y-4">
          
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-500 uppercase ml-1">Employee ID</label>
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                value={empId}
                onChange={(e) => setEmpId(e.target.value.toUpperCase())}
                placeholder="e.g. EMP101" 
                className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-500 uppercase ml-1">Mobile Number</label>
            <div className="relative">
              <Phone className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="tel" 
                value={mobileNo}
                onChange={(e) => setMobileNo(e.target.value)}
                placeholder="Your WhatsApp Number" 
                className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>
          
          {error && <p className="text-red-500 text-sm text-center font-medium mt-2">{error}</p>}
          
          <button 
            type="submit"
            disabled={isLoading || !empId || !mobileNo}
            className="w-full py-3 mt-4 bg-blue-600 text-white rounded-xl font-medium flex justify-center items-center gap-2 hover:bg-blue-700 transition-colors disabled:opacity-70"
          >
            {isLoading ? "Checking in..." : "Check In Now"}
            {!isLoading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <div className="pt-3 border-t border-gray-100 dark:border-zinc-800 text-center">
          <Link
            href="/player/register"
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline inline-flex items-center gap-1 transition-colors"
          >
            Not registered? Register New Player
          </Link>
        </div>
      </div>
    </div>
  );
}
