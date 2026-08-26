"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Bell, MapPin, Clock, CalendarDays, CheckCircle2, XCircle, Trophy } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

export default function PlayerDashboard() {
  const searchParams = useSearchParams();
  const playerId = searchParams.get("id");
  
  const [player, setPlayer] = useState<any>(null);
  const [nextMatch, setNextMatch] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [hasAcknowledged, setHasAcknowledged] = useState(false);
  const [responseType, setResponseType] = useState<"COMING" | "UNAVAILABLE" | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<string>("default");

  const supabase = createClient();

  useEffect(() => {
    if ("Notification" in window) {
      setNotificationStatus(Notification.permission);
    }
    
    async function loadDashboard() {
      if (!playerId) {
        setIsLoading(false);
        return;
      }
      
      const { data: pData } = await supabase.from('players').select('*').eq('id', playerId).single();
      if (pData) setPlayer(pData);
      
      const { data: mData } = await supabase
        .from('matches')
        .select(`
          id, sport, category, playing_area, scheduled_time, reporting_time, status,
          team1_p1:players!fk_t1p1(id, name),
          team1_p2:players!fk_t1p2(id, name),
          team2_p1:players!fk_t2p1(id, name),
          team2_p2:players!fk_t2p2(id, name)
        `)
        .or(`team1_p1_id.eq.${playerId},team1_p2_id.eq.${playerId},team2_p1_id.eq.${playerId},team2_p2_id.eq.${playerId}`)
        .in('status', ['SCHEDULED', 'NOTIFIED', 'NO-SHOW PENDING', 'DELAYED'])
        .order('scheduled_time', { ascending: true })
        .limit(1);
        
      if (mData && mData.length > 0) {
        setNextMatch(mData[0]);
      }
      
      setIsLoading(false);
    }
    
    loadDashboard();
  }, [playerId, supabase]);

  const requestNotifications = async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      setNotificationStatus(permission);
      if (permission === 'granted') {
        alert("Notifications enabled! You will be alerted when your match is called.");
      }
    }
  };

  const handleResponse = async (type: "COMING" | "UNAVAILABLE") => {
    if (!nextMatch || !playerId) return;
    setResponseType(type);
    setHasAcknowledged(true);
    
    try {
      if (type === 'COMING') {
        const { error } = await supabase.rpc('player_accept_match', { p_player_id: playerId, p_match_id: nextMatch.id });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('player_reject_match', { p_player_id: playerId, p_match_id: nextMatch.id });
        if (error) throw error;
      }
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
      setHasAcknowledged(false);
    }
  };

  const format12Hour = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const getOpponentText = () => {
    if (!nextMatch || !playerId) return "TBD";
    const isTeam1 = nextMatch.team1_p1?.id === playerId || nextMatch.team1_p2?.id === playerId;
    
    let oppTeam = isTeam1 
      ? [nextMatch.team2_p1, nextMatch.team2_p2]
      : [nextMatch.team1_p1, nextMatch.team1_p2];
      
    oppTeam = oppTeam.filter(Boolean);
    
    if (oppTeam.length === 0) return "TBD";
    if (oppTeam.length === 1) return oppTeam[0].name;
    return `${oppTeam[0].name} & ${oppTeam[1].name}`;
  };

  const getPartnerText = () => {
    if (!nextMatch || !playerId) return null;
    const isTeam1 = nextMatch.team1_p1?.id === playerId || nextMatch.team1_p2?.id === playerId;
    const myTeam = isTeam1 ? [nextMatch.team1_p1, nextMatch.team1_p2] : [nextMatch.team2_p1, nextMatch.team2_p2];
    const partner = myTeam.filter(Boolean).find((p: any) => p.id !== playerId);
    return partner ? partner.name : null;
  };

  if (isLoading) return <div className="p-8 text-center text-gray-500">Loading your profile...</div>;
  if (!player) return <div className="p-8 text-center text-red-500">Player not found or invalid link.</div>;

  const opponentName = getOpponentText();
  const partnerName = getPartnerText();

  return (
    <div className="p-4 space-y-6 pb-20">
      
      {notificationStatus !== 'granted' && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex gap-3 shadow-sm">
          <Bell className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900 dark:text-blue-300 text-sm">Enable Notifications</h3>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1 mb-2">
              Don't miss your match! Get alerted directly on your phone when it's time to report.
            </p>
            <button onClick={requestNotifications} className="text-xs font-bold bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors">
              Allow Notifications
            </button>
          </div>
        </div>
      )}

      {/* Header Info */}
      <div className="flex justify-between items-center bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-bold">Hi, {player.name.split(' ')[0]} 👋</h2>
          <p className="text-gray-500 text-sm">{player.employee_id} • {player.sport}</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-gray-400 mb-1">STATUS</span>
          <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide ${
            player.status === 'PRESENT' || player.status === 'AVAILABLE' ? 'bg-green-100 text-green-800' :
            player.status === 'PLAYING' ? 'bg-blue-100 text-blue-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {player.status}
          </span>
        </div>
      </div>

      {/* Main Match Card */}
      <div className="space-y-3">
        <h3 className="font-bold text-gray-700 dark:text-gray-300 px-1">NEXT MATCH</h3>
        
        {!nextMatch ? (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-8 shadow-sm border border-gray-200 dark:border-zinc-800 text-center space-y-3">
            <div className="w-12 h-12 bg-gray-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto text-gray-400">
              <Trophy className="w-6 h-6" />
            </div>
            <p className="font-medium text-gray-600 dark:text-gray-400">You have no upcoming matches scheduled yet.</p>
            <p className="text-sm text-gray-400">Please relax and wait for the committee's announcement.</p>
          </div>
        ) : (
          <div className="bg-blue-600 text-white rounded-2xl p-5 shadow-lg relative overflow-hidden">
            <div className="absolute -right-4 -top-4 text-blue-500 opacity-50">
              <TrophyIcon className="w-24 h-24" />
            </div>
            
            <div className="relative z-10 space-y-6">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-blue-100 text-xs font-semibold tracking-wider mb-1 uppercase">{nextMatch.sport} • {nextMatch.category}</div>
                  <div className="text-2xl font-bold leading-tight mt-1">vs {opponentName}</div>
                  {partnerName && <div className="text-blue-200 text-sm mt-1">Partner: {partnerName}</div>}
                </div>
                {nextMatch.status === 'NO-SHOW PENDING' ? (
                  <div className="bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded animate-pulse">URGENT</div>
                ) : (
                  <div className="bg-blue-500 text-white text-[10px] font-bold px-2 py-1 rounded">UPCOMING</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 bg-blue-700/50 p-4 rounded-xl">
                <div className="space-y-1">
                  <div className="text-blue-200 text-xs flex items-center"><MapPin className="w-3 h-3 mr-1" /> Area</div>
                  <div className="font-semibold">{nextMatch.playing_area}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-blue-200 text-xs flex items-center"><Clock className="w-3 h-3 mr-1" /> Report By</div>
                  <div className="font-semibold text-amber-300">
                    {nextMatch.reporting_time ? format12Hour(nextMatch.reporting_time) : 'ASAP'}
                  </div>
                </div>
                <div className="space-y-1 col-span-2">
                  <div className="text-blue-200 text-xs flex items-center"><CalendarDays className="w-3 h-3 mr-1" /> Match Time</div>
                  <div className="font-semibold">
                    {format12Hour(nextMatch.scheduled_time)}
                  </div>
                </div>
              </div>

              {!hasAcknowledged ? (
                <div className="flex gap-3 pt-2">
                  <button onClick={() => handleResponse("UNAVAILABLE")} className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors text-sm">
                    I'M UNAVAILABLE
                  </button>
                  <button onClick={() => handleResponse("COMING")} className="flex-1 py-3 bg-white text-blue-700 hover:bg-blue-50 rounded-xl font-bold transition-colors text-sm shadow-md">
                    I'M COMING
                  </button>
                </div>
              ) : (
                <div className={`p-4 rounded-xl flex items-center gap-3 ${responseType === 'COMING' ? 'bg-green-500/20 text-green-100' : 'bg-red-500/20 text-red-100'}`}>
                  {responseType === 'COMING' ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
                  <div>
                    <div className="font-bold">Response Recorded</div>
                    <div className="text-xs opacity-90">
                      {responseType === 'COMING' ? 'The committee knows you are on your way.' : 'The committee has been notified you are unavailable.'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrophyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}
