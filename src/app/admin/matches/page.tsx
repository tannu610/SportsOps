"use client";

import { useState, useEffect } from "react";
import { Plus, Clock, AlertTriangle, X, Trash2, CheckCircle2, PlayCircle, XCircle, Trophy } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const SPORT_CONFIG: Record<string, { areaLabel: string; areas: string[]; categories: string[] }> = {
  "Badminton": { areaLabel: "Court", areas: ["Court 1", "Court 2", "Court 3", "Court 4"], categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"] },
  "Table Tennis": { areaLabel: "Table", areas: ["Table 1", "Table 2", "Table 3"], categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"] },
  "Cricket": { areaLabel: "Ground", areas: ["Ground 1", "Ground 2"], categories: ["NA"] },
  "Football": { areaLabel: "Ground", areas: ["Ground 1", "Ground 2"], categories: ["NA"] },
  "Volleyball": { areaLabel: "Court", areas: ["Court 1", "Court 2"], categories: ["NA"] },
  "Other": { areaLabel: "Playing Area", areas: ["Area 1", "Area 2", "Area 3"], categories: ["NA"] }
};

const PHASES = ["Round 1", "Round 2", "Round 3", "Quarter Final", "Semi Final", "Final"];

type Player = { id: string; employee_id: string; name: string; contact_info: string; status: string; sport: string };
type Match = { 
  id: string; 
  sport: string;
  category: string;
  phase: string;
  playing_area: string; 
  scheduled_time: string; 
  status: string;
  team1_p1: Player | null;
  team1_p2: Player | null;
  team2_p1: Player | null;
  team2_p2: Player | null;
};

export default function MatchesPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [finishingMatch, setFinishingMatch] = useState<{ match: Match, isWalkover: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);

  // Form State
  const [sport, setSport] = useState("Badminton");
  const [category, setCategory] = useState("Men's Singles");
  const [phase, setPhase] = useState("Round 1");
  const [area, setArea] = useState("Court 1");
  const [t1p1, setT1p1] = useState("");
  const [t1p2, setT1p2] = useState("");
  const [t2p1, setT2p1] = useState("");
  const [t2p2, setT2p2] = useState("");
  const [matchTime, setMatchTime] = useState("");

  const supabase = createClient();

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      const { data: events } = await supabase.from('events').select('id').limit(1);
      if (events && events.length > 0) {
        const currentEventId = events[0].id;
        setEventId(currentEventId);
        
        const { data: dbPlayers } = await supabase
          .from('players')
          .select('id, employee_id, name, contact_info, status, sport')
          .eq('event_id', currentEventId)
          .neq('status', 'REGISTERED')
          .neq('status', 'ABSENT')
          .order('name');
          
        if (dbPlayers) setPlayers(dbPlayers);

        const { data: dbMatches } = await supabase
          .from('matches')
          .select(`
            id, sport, category, phase, playing_area, scheduled_time, status,
            team1_p1:players!fk_t1p1(id, employee_id, name, contact_info),
            team1_p2:players!fk_t1p2(id, employee_id, name, contact_info),
            team2_p1:players!fk_t2p1(id, employee_id, name, contact_info),
            team2_p2:players!fk_t2p2(id, employee_id, name, contact_info)
          `)
          .eq('event_id', currentEventId)
          .order('created_at', { ascending: false });
          
        if (dbMatches) setMatches(dbMatches as any);
      }
      setIsLoading(false);
    }
    loadData();

    const channel = supabase
      .channel('matches_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleSportChange = (newSport: string) => {
    setSport(newSport);
    const config = SPORT_CONFIG[newSport] || SPORT_CONFIG["Other"];
    setCategory(config.categories[0]);
    setArea(config.areas[0]);
  };

  const getPlayerIdByEmpId = (empId: string) => {
    if (!empId) return null;
    const p = players.find(pl => pl.employee_id.toUpperCase() === empId.toUpperCase());
    return p ? p.id : null;
  };

  const handleCreateMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !t1p1 || !t2p1 || !matchTime) return;
    
    const id_t1p1 = getPlayerIdByEmpId(t1p1);
    const id_t2p1 = getPlayerIdByEmpId(t2p1);
    const id_t1p2 = getPlayerIdByEmpId(t1p2);
    const id_t2p2 = getPlayerIdByEmpId(t2p2);

    if (!id_t1p1 || !id_t2p1) {
      alert("Invalid primary players selected. Please ensure Employee IDs are correct and they are eligible for this round.");
      return;
    }

    const selectedIds = [id_t1p1, id_t2p1, id_t1p2, id_t2p2].filter(Boolean);
    const uniqueIds = new Set(selectedIds);
    if (selectedIds.length !== uniqueIds.size) {
      alert("A player cannot be selected more than once in the same match.");
      return;
    }

    const date = new Date();
    const [hours, minutes] = matchTime.split(':');
    date.setHours(Number(hours), Number(minutes), 0, 0);
    const matchTimestamp = date.toISOString();

    const { error } = await supabase.from('matches').insert([{
      event_id: eventId, sport, category, phase, playing_area: area,
      team1_p1_id: id_t1p1, team1_p2_id: id_t1p2, team2_p1_id: id_t2p1, team2_p2_id: id_t2p2,
      scheduled_time: matchTimestamp, status: 'SCHEDULED'
    }]);

    if (error) return alert("Error creating match: " + error.message);
    await supabase.rpc('call_players_for_match', { p_player_ids: selectedIds });
    setIsCreating(false);
    setT1p1(""); setT2p1(""); setT1p2(""); setT2p2(""); setMatchTime("");
  };

  const deleteMatch = async (matchId: string) => {
    if (!confirm("Are you sure you want to delete this match? All players will cleanly revert to their exact previous status.")) return;
    const { error } = await supabase.rpc('delete_match_and_rollback', { p_match_id: matchId });
    if (error) alert("Error deleting match: " + error.message);
  };

  const updateMatchStatus = async (matchId: string, newStatus: string) => {
    const { error } = await supabase.from('matches').update({ status: newStatus }).eq('id', matchId);
    if (error) alert("Error: " + error.message);
  };

  const submitMatchResult = async (winningTeam: 'team1' | 'team2') => {
    if (!finishingMatch) return;
    const { error } = await supabase.rpc('complete_match_workflow', {
      p_match_id: finishingMatch.match.id,
      p_winning_team: winningTeam,
      p_is_walkover: finishingMatch.isWalkover
    });
    if (error) alert("Error saving match completion: " + error.message);
    setFinishingMatch(null);
  };

  const format12Hour = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const activeConfig = SPORT_CONFIG[sport] || SPORT_CONFIG["Other"];
  const isDoubles = category.includes("Doubles");

  const eligiblePlayers = players.filter(p => {
    if (phase === "Round 1") return p.status === "PRESENT" || p.status === "AVAILABLE";
    if (phase === "Round 2") return p.status === "QUALIFIED - Round 1";
    if (phase === "Round 3") return p.status === "QUALIFIED - Round 2";
    if (phase === "Quarter Final") return p.status.includes("QUALIFIED");
    if (phase === "Semi Final") return p.status === "QUALIFIED - Quarter Final";
    if (phase === "Final") return p.status === "QUALIFIED - Semi Final";
    return true; 
  });

  return (
    <div className="space-y-10 relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 bg-gradient-to-r from-blue-900 via-indigo-900 to-purple-900 p-8 rounded-[2rem] shadow-xl text-white">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-400" /> Match Management
          </h1>
          <p className="text-indigo-200 font-medium mt-2 text-sm">Orchestrate brackets, courts, and walkovers.</p>
        </div>
        <button onClick={() => setIsCreating(true)} className="flex items-center px-6 py-3 bg-white text-indigo-900 rounded-xl text-sm font-black hover:bg-gray-100 shadow-lg shadow-indigo-900/50 transition-all w-full sm:w-auto">
          <Plus className="w-5 h-5 mr-2" /> Create Match
        </button>
      </div>

      <datalist id="eligible-players">
        {eligiblePlayers.map(p => <option key={p.id} value={p.employee_id}>{p.name} ({p.sport}) - {p.status}</option>)}
      </datalist>

      {/* Completion Modal */}
      {finishingMatch && (
        <div className="fixed inset-0 bg-indigo-950/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-10 w-full max-w-md shadow-2xl border border-white/20 text-center space-y-8 transform transition-all">
            <div>
              <h2 className="text-3xl font-black text-gray-900 dark:text-white">
                {finishingMatch.isWalkover ? "Confirm Walkover" : "Confirm Result"}
              </h2>
              <p className="text-sm text-gray-500 font-medium mt-3">
                {finishingMatch.isWalkover 
                  ? "Select which team showed up and wins the walkover." 
                  : "Select the team that won. They will be marked as QUALIFIED."}
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => submitMatchResult('team1')} className="p-6 border-2 border-blue-200 bg-gradient-to-b from-blue-50 to-blue-100/50 hover:to-blue-200/50 rounded-3xl text-blue-900 font-bold flex flex-col items-center transition-all hover:scale-105 shadow-sm">
                <CheckCircle2 className="w-12 h-12 text-blue-500 mb-4 drop-shadow-sm" />
                Team 1 Wins
                <span className="text-xs font-semibold text-blue-600/80 mt-2">{finishingMatch.match.team1_p1?.name}</span>
              </button>
              
              <button onClick={() => submitMatchResult('team2')} className="p-6 border-2 border-rose-200 bg-gradient-to-b from-rose-50 to-rose-100/50 hover:to-rose-200/50 rounded-3xl text-rose-900 font-bold flex flex-col items-center transition-all hover:scale-105 shadow-sm">
                <CheckCircle2 className="w-12 h-12 text-rose-500 mb-4 drop-shadow-sm" />
                Team 2 Wins
                <span className="text-xs font-semibold text-rose-600/80 mt-2">{finishingMatch.match.team2_p1?.name}</span>
              </button>
            </div>
            
            <button onClick={() => setFinishingMatch(null)} className="text-sm font-bold text-gray-400 hover:text-gray-900 transition-colors tracking-widest uppercase">Cancel</button>
          </div>
        </div>
      )}

      {/* Creation Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-indigo-950/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-10 w-full max-w-3xl shadow-2xl relative border border-white/20">
            <button onClick={() => setIsCreating(false)} className="absolute top-8 right-8 text-gray-300 hover:text-gray-900 bg-gray-50 rounded-full p-2 transition-all"><X className="w-6 h-6" /></button>
            <h2 className="text-3xl font-black mb-10 text-gray-900 dark:text-white flex items-center gap-3">
              <span className="bg-indigo-100 text-indigo-600 p-2 rounded-xl"><Plus className="w-6 h-6"/></span> Create Match
            </h2>
            
            <form className="space-y-8" onSubmit={handleCreateMatch}>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Match Type</label>
                  <select value={sport} onChange={(e) => handleSportChange(e.target.value)} className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 text-gray-800 font-bold focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all">
                    {Object.keys(SPORT_CONFIG).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Phase</label>
                  <select value={phase} onChange={(e) => setPhase(e.target.value)} className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 text-gray-800 font-bold focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all">
                    {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Category</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 text-gray-800 font-bold focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all">
                    {activeConfig.categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">{activeConfig.areaLabel}</label>
                  <select value={area} onChange={(e) => setArea(e.target.value)} className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 text-gray-800 font-bold focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all">
                    {activeConfig.areas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div className="space-y-5 bg-gradient-to-b from-blue-50 to-white p-6 rounded-3xl border-2 border-blue-100">
                  <h3 className="font-black text-sm text-blue-600 tracking-widest flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-600"></span> TEAM 1</h3>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Player 1 (Emp ID)</label>
                    <input required type="text" list="eligible-players" value={t1p1} onChange={(e) => setT1p1(e.target.value)} placeholder="Select Player..." className="w-full p-4 border-2 border-blue-100 bg-white shadow-sm rounded-2xl font-bold text-blue-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all" />
                  </div>
                  {isDoubles && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Player 2 (Emp ID)</label>
                      <input required type="text" list="eligible-players" value={t1p2} onChange={(e) => setT1p2(e.target.value)} placeholder="Select Player..." className="w-full p-4 border-2 border-blue-100 bg-white shadow-sm rounded-2xl font-bold text-blue-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all" />
                    </div>
                  )}
                </div>
                
                <div className="space-y-5 bg-gradient-to-b from-rose-50 to-white p-6 rounded-3xl border-2 border-rose-100">
                  <h3 className="font-black text-sm text-rose-600 tracking-widest flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-rose-600"></span> TEAM 2</h3>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Player 1 (Emp ID)</label>
                    <input required type="text" list="eligible-players" value={t2p1} onChange={(e) => setT2p1(e.target.value)} placeholder="Select Player..." className="w-full p-4 border-2 border-rose-100 bg-white shadow-sm rounded-2xl font-bold text-rose-900 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 outline-none transition-all" />
                  </div>
                  {isDoubles && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Player 2 (Emp ID)</label>
                      <input required type="text" list="eligible-players" value={t2p2} onChange={(e) => setT2p2(e.target.value)} placeholder="Select Player..." className="w-full p-4 border-2 border-rose-100 bg-white shadow-sm rounded-2xl font-bold text-rose-900 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 outline-none transition-all" />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2 max-w-xs">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Match Time</label>
                <input type="time" required value={matchTime} onChange={(e) => setMatchTime(e.target.value)} className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 text-gray-800 font-bold focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all" />
              </div>

              <div className="pt-8 flex justify-end gap-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsCreating(false)} className="px-8 py-4 bg-gray-50 text-gray-500 rounded-2xl text-sm font-black tracking-widest uppercase hover:bg-gray-100 transition-colors">Cancel</button>
                <button type="submit" className="px-8 py-4 bg-indigo-600 text-white rounded-2xl text-sm font-black tracking-widest uppercase shadow-xl shadow-indigo-200 hover:bg-indigo-700 hover:shadow-indigo-300 transition-all">Create & Notify</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-6">
          <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-widest">Today's Fixtures</h2>
          
          {isLoading ? (
            <div className="p-16 text-center text-gray-400 font-medium">Loading matches...</div>
          ) : matches.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold border-2 rounded-3xl border-dashed border-gray-200 bg-gray-50/50">No matches created yet.</div>
          ) : (
            matches.map((match) => (
              <div key={match.id} className={`rounded-3xl border-2 flex flex-col justify-between overflow-hidden transition-all duration-300 hover:shadow-xl ${
                match.status === 'LIVE' ? 'bg-white border-emerald-400 shadow-emerald-100' : 
                match.status === 'PLAYER_UNAVAILABLE' ? 'bg-rose-50/30 border-rose-300 shadow-rose-100' :
                match.status === 'NO-SHOW PENDING' ? 'bg-amber-50/30 border-amber-300 shadow-amber-100' : 
                match.status === 'COMPLETED' ? 'bg-gray-50 border-gray-200 opacity-60 grayscale-[0.2]' :
                'bg-white border-gray-100 hover:border-indigo-200'
              }`}>
                {/* Accent Top Bar */}
                <div className={`h-1.5 w-full ${
                  match.status === 'LIVE' ? 'bg-gradient-to-r from-emerald-400 to-teal-500' :
                  match.status === 'PLAYER_UNAVAILABLE' ? 'bg-gradient-to-r from-rose-400 to-red-500' :
                  match.status === 'NO-SHOW PENDING' ? 'bg-gradient-to-r from-amber-400 to-orange-500' :
                  match.status === 'COMPLETED' ? 'bg-gray-300' :
                  'bg-gradient-to-r from-blue-500 to-indigo-500'
                }`}></div>

                <div className="p-6 flex-1 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                        match.status === 'LIVE' ? 'bg-emerald-500 text-white animate-pulse shadow-md shadow-emerald-200' : 
                        match.status === 'PLAYER_UNAVAILABLE' ? 'bg-rose-500 text-white shadow-md shadow-rose-200' :
                        match.status === 'NO-SHOW PENDING' ? 'bg-amber-500 text-white shadow-md shadow-amber-200' : 
                        match.status === 'COMPLETED' ? 'bg-gray-200 text-gray-500' :
                        'bg-indigo-100 text-indigo-700'
                      }`}>
                        {match.status}
                      </span>
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest bg-gray-50 px-3 py-1.5 rounded-xl">{match.sport} • {match.phase}</span>
                    </div>
                    {match.status !== 'COMPLETED' && (
                      <button onClick={() => deleteMatch(match.id)} className="text-gray-300 hover:text-rose-500 transition-colors p-2 hover:bg-rose-50 rounded-full" title="Delete & Rollback Players"><Trash2 className="w-5 h-5" /></button>
                    )}
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 w-full">
                    <div className="flex-1 bg-gradient-to-br from-blue-50 to-white border-2 border-blue-50 p-4 rounded-2xl w-full text-center sm:text-right">
                      <div className="font-black text-blue-900 text-xl">{match.team1_p1?.name}</div>
                      {match.team1_p2 && <div className="font-black text-blue-900 text-xl">{match.team1_p2.name}</div>}
                    </div>
                    
                    <div className="shrink-0 bg-gradient-to-br from-indigo-500 to-purple-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-xs shadow-lg shadow-indigo-200 z-10 border-4 border-white">
                      VS
                    </div>
                    
                    <div className="flex-1 bg-gradient-to-bl from-rose-50 to-white border-2 border-rose-50 p-4 rounded-2xl w-full text-center sm:text-left">
                      <div className="font-black text-rose-900 text-xl">{match.team2_p1?.name}</div>
                      {match.team2_p2 && <div className="font-black text-rose-900 text-xl">{match.team2_p2.name}</div>}
                    </div>
                  </div>
                  
                  <div className="text-xs font-black text-gray-500 flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-xl"><CheckCircle2 className="w-4 h-4 text-indigo-500" /> {match.playing_area}</span>
                    <span className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-xl"><Clock className="w-4 h-4 text-rose-500" /> {format12Hour(match.scheduled_time)}</span>
                  </div>
                </div>
                
                {match.status !== 'COMPLETED' && (
                  <div className="flex flex-wrap gap-3 bg-gray-50/50 p-4 sm:px-6 border-t border-gray-100">
                    {match.status === 'SCHEDULED' && <button onClick={() => updateMatchStatus(match.id, 'LIVE')} className="px-5 py-2.5 bg-white text-indigo-700 border-2 border-indigo-100 hover:bg-indigo-50 hover:border-indigo-300 rounded-xl text-sm font-black transition-all flex items-center gap-2 shadow-sm"><PlayCircle className="w-4 h-4"/> Start Live</button>}
                    {match.status === 'LIVE' && <button onClick={() => setFinishingMatch({ match, isWalkover: false })} className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 shadow-lg shadow-emerald-200 rounded-xl text-sm font-black flex items-center gap-2 transition-all"><CheckCircle2 className="w-4 h-4"/> Complete Match</button>}
                    {match.status === 'SCHEDULED' && <button onClick={() => updateMatchStatus(match.id, 'NO-SHOW PENDING')} className="px-5 py-2.5 border-2 border-gray-200 text-gray-500 bg-white hover:bg-gray-50 rounded-xl text-sm font-bold transition-all">Trigger No-Show</button>}
                    {match.status === 'NO-SHOW PENDING' && (
                      <button onClick={() => setFinishingMatch({ match, isWalkover: true })} className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-200 hover:shadow-xl rounded-xl text-sm font-black transition-all flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Confirm Walkover</button>
                    )}
                    {match.status === 'PLAYER_UNAVAILABLE' && (
                      <button onClick={() => updateMatchStatus(match.id, 'SCHEDULED')} className="px-5 py-2.5 bg-white border-2 border-rose-100 text-rose-600 hover:bg-rose-50 rounded-xl text-sm font-black transition-all flex items-center gap-2"><XCircle className="w-4 h-4"/> Reset to Scheduled</button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-widest flex items-center gap-2">Attention</h2>
          {matches.filter(m => m.status === 'NO-SHOW PENDING' || m.status === 'PLAYER_UNAVAILABLE').length === 0 ? (
             <div className="p-10 text-sm font-bold text-gray-400 border-2 rounded-3xl border-dashed border-gray-200 bg-gray-50/50 text-center">No active alerts.</div>
          ) : (
            matches.filter(m => m.status === 'NO-SHOW PENDING' || m.status === 'PLAYER_UNAVAILABLE').map(m => (
              <div key={`alert-${m.id}`} className={`${m.status === 'PLAYER_UNAVAILABLE' ? 'bg-gradient-to-br from-rose-500 to-red-600 border-rose-600 text-white shadow-rose-200' : 'bg-gradient-to-br from-amber-400 to-orange-500 border-amber-500 text-white shadow-amber-200'} border rounded-3xl p-6 shadow-xl`}>
                <div className="flex gap-4 items-start">
                  <div className="p-3 rounded-2xl bg-white/20 backdrop-blur-sm shrink-0">
                    <AlertTriangle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-black text-base tracking-wide">
                      {m.status === 'PLAYER_UNAVAILABLE' ? 'Match Rejected' : 'Walkover Required'}
                    </h3>
                    <p className="text-sm font-medium mt-2 leading-relaxed text-white/90">
                      {m.status === 'PLAYER_UNAVAILABLE' 
                        ? `A player for match at ${m.playing_area} just clicked "I'M UNAVAILABLE". Please manually delete or walkover.` 
                        : `Match at ${m.playing_area} reached no-show limit. Confirm walkover or delete.`}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

