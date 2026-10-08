"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import {
  Trophy,
  PlayCircle,
  CheckCircle2,
  Clock,
  Check,
  Copy,
  AlertCircle,
  ArrowLeft,
  Search,
  User,
  ShieldAlert,
  Loader2,
  RotateCcw
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

interface PlayerInfo {
  id: string;
  name: string;
}

interface RefereeMatch {
  id: string;
  match_code: string;
  sport: string;
  category: string;
  phase: string;
  playing_area: string;
  scheduled_time: string;
  reporting_time?: string | null;
  status: string;
  team1: PlayerInfo[];
  team2: PlayerInfo[];
  winner_id: string | null;
  winner_name: string | null;
  winning_team: "team1" | "team2" | null;
  score_notes: string | null;
  referee_name: string | null;
  completed_at: string | null;
}

export default function RefereePortalPage() {
  const supabase = createClient();

  // Inputs
  const [refereeName, setRefereeName] = useState("");
  const [matchCodeInput, setMatchCodeInput] = useState("");

  // Match State
  const [activeMatch, setActiveMatch] = useState<RefereeMatch | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  // Operational Action States
  const [isStarting, setIsStarting] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [selectedWinnerTeam, setSelectedWinnerTeam] = useState<"team1" | "team2" | null>(null);
  const [scoreNotesInput, setScoreNotesInput] = useState("");
  const [completeError, setCompleteError] = useState("");

  // Load saved referee name on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedName = localStorage.getItem("sportsops_referee_name");
      if (savedName) {
        setRefereeName(savedName);
      }
    }
  }, []);

  // Format 12-hour time matching Admin Play Area Management
  const format12Hour = (isoString?: string | null) => {
    if (!isoString) return "";
    try {
      return new Date(isoString).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "";
    }
  };

  // Compute reporting time (10 min before scheduled if not set)
  const getReportingTime = (scheduledIso: string, reportingIso?: string | null) => {
    if (reportingIso) return format12Hour(reportingIso);
    if (!scheduledIso) return "";
    try {
      const date = new Date(scheduledIso);
      date.setMinutes(date.getMinutes() - 10);
      return format12Hour(date.toISOString());
    } catch {
      return "";
    }
  };

  // Handle Copy Match Code
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Core Match Lookup
  const fetchMatch = useCallback(
    async (codeToFind: string, currentRefName: string, silent = false) => {
      const cleanCode = codeToFind.trim().toUpperCase();
      if (!cleanCode) {
        setErrorMessage("Please enter a 6-character Match Code.");
        return;
      }

      if (!silent) {
        setIsSearching(true);
        setErrorMessage("");
      }

      try {
        const res = await fetch("/api/referee/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            matchCode: cleanCode,
            refereeName: currentRefName.trim() || undefined,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          if (!silent) {
            setErrorMessage(data.message || "Match not found. Please check the Match Code provided by the committee.");
            setActiveMatch(null);
          }
          return;
        }

        setActiveMatch(data.match);
        setErrorMessage("");

        // Save referee name in localStorage if provided
        if (currentRefName.trim() && typeof window !== "undefined") {
          localStorage.setItem("sportsops_referee_name", currentRefName.trim());
        }
      } catch (err: any) {
        if (!silent) {
          setErrorMessage("Failed to look up match. Please check your connection and try again.");
        }
      } finally {
        if (!silent) {
          setIsSearching(false);
        }
      }
    },
    []
  );

  // Submit Lookup Form
  const handleFindMatch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!refereeName.trim()) {
      setErrorMessage("Please enter your name as the referee.");
      return;
    }
    fetchMatch(matchCodeInput, refereeName);
  };

  // Realtime subscription for bi-directional Admin <-> Referee sync
  useEffect(() => {
    if (!activeMatch?.id) return;

    const channel = supabase
      .channel(`referee_match_${activeMatch.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matches",
          filter: `id=eq.${activeMatch.id}`,
        },
        () => {
          // Re-fetch match silently
          fetchMatch(activeMatch.match_code, refereeName, true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeMatch?.id, activeMatch?.match_code, refereeName, fetchMatch, supabase]);

  // Operational Action 1: START MATCH
  const handleStartMatch = async () => {
    if (!activeMatch) return;
    if (!refereeName.trim()) {
      alert("Please enter your name.");
      return;
    }

    setIsStarting(true);
    try {
      const res = await fetch("/api/referee/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchCode: activeMatch.match_code,
          refereeName: refereeName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || data.error || "Failed to start match.");
        return;
      }

      setActiveMatch(data.match);
      if (typeof window !== "undefined") {
        localStorage.setItem("sportsops_referee_name", refereeName.trim());
      }
    } catch (err: any) {
      alert("Error starting match: " + (err.message || "Network error"));
    } finally {
      setIsStarting(false);
    }
  };

  // Open Complete Modal
  const handleOpenCompleteModal = () => {
    setSelectedWinnerTeam(null);
    setScoreNotesInput("");
    setCompleteError("");
    setShowCompleteModal(true);
  };

  // Operational Action 2: CONFIRM COMPLETE MATCH
  const handleConfirmComplete = async () => {
    if (!activeMatch) return;
    if (!selectedWinnerTeam) {
      setCompleteError("Please select the winning player/team.");
      return;
    }

    setIsCompleting(true);
    setCompleteError("");

    try {
      const res = await fetch("/api/referee/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchCode: activeMatch.match_code,
          refereeName: refereeName.trim() || activeMatch.referee_name || undefined,
          winningTeam: selectedWinnerTeam,
          scoreNotes: scoreNotesInput.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setCompleteError(data.message || data.error || "Failed to complete match.");
        return;
      }

      setActiveMatch(data.match);
      setShowCompleteModal(false);
    } catch (err: any) {
      setCompleteError("Error completing match: " + (err.message || "Network error"));
    } finally {
      setIsCompleting(false);
    }
  };

  // Reset to Look Up Another Match
  const handleResetToLookup = () => {
    setActiveMatch(null);
    setMatchCodeInput("");
    setErrorMessage("");
    setShowCompleteModal(false);
  };

  // Formatter helpers for team names
  const renderTeamNames = (team: PlayerInfo[]) => {
    if (!team || team.length === 0) return "TBD";
    return team.map((p) => p.name).join(" & ");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white pb-12">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-black text-white text-base shadow-sm">
            SO
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-indigo-400 leading-tight">
              SPORTSOPS MATCHDAY
            </p>
            <h1 className="text-sm font-black tracking-wide text-white leading-tight">
              REFEREE PORTAL
            </h1>
          </div>
        </div>

        {activeMatch && (
          <button
            type="button"
            onClick={handleResetToLookup}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>New Code</span>
          </button>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-lg mx-auto p-4 sm:p-6 flex flex-col">
        {!activeMatch ? (
          /* ======================================================== */
          /* SCREEN 1: MATCH LOOKUP FORM                               */
          /* ======================================================== */
          <div className="my-auto py-6">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
              <div className="text-center space-y-1.5">
                <div className="inline-flex p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 mb-2 border border-indigo-500/20">
                  <Trophy className="w-8 h-8" />
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  Enter Match Details
                </h2>
                <p className="text-xs sm:text-sm text-slate-400">
                  Enter the Match Code provided by the tournament committee.
                </p>
              </div>

              {errorMessage && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-3 text-rose-300 text-xs sm:text-sm animate-in fade-in">
                  <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Match not found</p>
                    <p className="text-rose-300/90 mt-0.5">{errorMessage}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleFindMatch} className="space-y-5">
                {/* Referee Name */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="refereeName"
                    className="block text-xs font-black uppercase tracking-wider text-slate-300"
                  >
                    Referee Name <span className="text-indigo-400">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="refereeName"
                      type="text"
                      required
                      placeholder="Enter your name"
                      value={refereeName}
                      onChange={(e) => setRefereeName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-white rounded-xl pl-10 pr-4 py-3.5 text-sm font-medium outline-hidden transition placeholder:text-slate-500"
                    />
                  </div>
                </div>

                {/* Match Code */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="matchCode"
                    className="block text-xs font-black uppercase tracking-wider text-slate-300"
                  >
                    Match Code <span className="text-indigo-400">*</span>
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="matchCode"
                      type="text"
                      required
                      maxLength={6}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="e.g. 9L27R8"
                      value={matchCodeInput}
                      onChange={(e) => setMatchCodeInput(e.target.value.toUpperCase().trim())}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-white font-mono tracking-widest font-black text-lg rounded-xl pl-10 pr-4 py-3.5 uppercase outline-hidden transition placeholder:text-slate-600 placeholder:tracking-normal placeholder:font-normal placeholder:text-sm"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Exact 6-character code provided by the committee.
                  </p>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSearching}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] disabled:opacity-50 text-white font-extrabold text-base py-3.5 px-4 rounded-xl shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>FINDING MATCH...</span>
                    </>
                  ) : (
                    <span>FIND MATCH</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* ======================================================== */
          /* SCREEN 2: MATCH CARD & OPERATIONAL CONTROLS              */
          /* ======================================================== */
          <div className="space-y-4 py-2">
            {/* Match Code & Status Header Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                    MATCH CODE
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono font-black text-2xl tracking-widest text-indigo-400">
                      {activeMatch.match_code}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(activeMatch.match_code)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                      title="Copy Match Code"
                    >
                      {copiedCode ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Status Indicator */}
                <div>
                  {activeMatch.status === "LIVE" ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      LIVE
                    </span>
                  ) : activeMatch.status === "COMPLETED" ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      COMPLETED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      {activeMatch.status}
                    </span>
                  )}
                </div>
              </div>

              {/* Tournament Match Info */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    SPORT
                  </span>
                  <span className="font-black text-slate-200 uppercase text-sm">
                    {activeMatch.sport}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    PLAYING AREA
                  </span>
                  <span className="font-black text-indigo-300 uppercase text-sm">
                    {activeMatch.playing_area}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    CATEGORY
                  </span>
                  <span className="font-bold text-slate-300">
                    {activeMatch.category}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    PHASE
                  </span>
                  <span className="font-bold text-slate-300">
                    {activeMatch.phase}
                  </span>
                </div>
              </div>

              {/* Teams & Players Display */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="w-[42%]">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                      TEAM 1
                    </span>
                    <p className="font-extrabold text-white text-sm sm:text-base mt-0.5 leading-snug break-words">
                      {renderTeamNames(activeMatch.team1)}
                    </p>
                  </div>

                  <div className="w-[16%] flex flex-col items-center justify-center">
                    <span className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-black text-slate-400">
                      VS
                    </span>
                  </div>

                  <div className="w-[42%] text-right">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                      TEAM 2
                    </span>
                    <p className="font-extrabold text-white text-sm sm:text-base mt-0.5 leading-snug break-words">
                      {renderTeamNames(activeMatch.team2)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Timing & Referee metadata */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    MATCH TIME
                  </span>
                  <span className="font-extrabold text-slate-200">
                    {format12Hour(activeMatch.scheduled_time) || "TBD"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    REPORT BY
                  </span>
                  <span className="font-extrabold text-amber-400">
                    {getReportingTime(activeMatch.scheduled_time, activeMatch.reporting_time) || "TBD"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    REFEREE
                  </span>
                  <span className="font-extrabold text-indigo-300 truncate block">
                    {activeMatch.referee_name || refereeName || "Not set"}
                  </span>
                </div>
              </div>
            </div>

            {/* Operational Action Controls */}
            {activeMatch.status === "COMPLETED" ? (
              /* Concluded Match Card */
              <div className="bg-slate-900 border border-indigo-500/30 rounded-3xl p-5 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-indigo-400 font-extrabold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span>This match has concluded.</span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between items-center py-1 border-b border-slate-800">
                    <span className="font-bold text-slate-400 uppercase text-[11px]">WINNER</span>
                    <span className="font-black text-emerald-400 text-sm">
                      {activeMatch.winner_name || "Winner declared"}
                    </span>
                  </div>

                  {activeMatch.score_notes && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-800">
                      <span className="font-bold text-slate-400 uppercase text-[11px]">RESULT</span>
                      <span className="font-bold text-white font-mono">
                        {activeMatch.score_notes}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between items-center py-1">
                    <span className="font-bold text-slate-400 uppercase text-[11px]">OFFICIAL REFEREE</span>
                    <span className="font-bold text-slate-300">
                      {activeMatch.referee_name || refereeName}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetToLookup}
                  className="w-full bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-white font-bold text-sm py-4 rounded-2xl border border-slate-700 flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-slate-400" />
                  <span>ENTER ANOTHER MATCH CODE</span>
                </button>
              </div>
            ) : activeMatch.status === "LIVE" ? (
              /* Live Control Card */
              <div className="space-y-3">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-3 text-center">
                  <p className="text-xs font-bold text-emerald-400">
                    Match is currently LIVE on {activeMatch.playing_area}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleOpenCompleteModal}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-black text-lg py-4 px-6 rounded-2xl shadow-xl shadow-emerald-600/20 flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <CheckCircle2 className="w-6 h-6" />
                  <span>COMPLETE MATCH</span>
                </button>
              </div>
            ) : (
              /* Scheduled Control Card */
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleStartMatch}
                  disabled={isStarting}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] disabled:opacity-50 text-white font-black text-lg py-4 px-6 rounded-2xl shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  {isStarting ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span>STARTING MATCH...</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle className="w-6 h-6" />
                      <span>START MATCH</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ======================================================== */}
      {/* MODAL: COMPLETE MATCH CONFIRMATION & WINNER SELECTION     */}
      {/* ======================================================== */}
      {showCompleteModal && activeMatch && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="text-left space-y-1">
              <h3 className="text-lg font-black text-white">Complete Match</h3>
              <p className="text-xs text-slate-400">
                Select the match winner and enter optional result details.
              </p>
            </div>

            {completeError && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-center gap-2 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{completeError}</span>
              </div>
            )}

            {/* Winner Selection Radio Cards */}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-300">
                Select Winner <span className="text-emerald-400">*</span>
              </label>

              {/* Option 1: Team 1 */}
              <button
                type="button"
                onClick={() => setSelectedWinnerTeam("team1")}
                className={`w-full p-4 rounded-2xl border text-left flex items-center justify-between transition cursor-pointer ${
                  selectedWinnerTeam === "team1"
                    ? "bg-emerald-500/15 border-emerald-500 text-white shadow-md shadow-emerald-500/10"
                    : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                    TEAM 1
                  </span>
                  <span className="font-extrabold text-sm block mt-0.5">
                    {renderTeamNames(activeMatch.team1)}
                  </span>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                    selectedWinnerTeam === "team1"
                      ? "border-emerald-400 bg-emerald-500 text-slate-950"
                      : "border-slate-700 bg-slate-900"
                  }`}
                >
                  {selectedWinnerTeam === "team1" && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </button>

              {/* Option 2: Team 2 */}
              <button
                type="button"
                onClick={() => setSelectedWinnerTeam("team2")}
                className={`w-full p-4 rounded-2xl border text-left flex items-center justify-between transition cursor-pointer ${
                  selectedWinnerTeam === "team2"
                    ? "bg-emerald-500/15 border-emerald-500 text-white shadow-md shadow-emerald-500/10"
                    : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                    TEAM 2
                  </span>
                  <span className="font-extrabold text-sm block mt-0.5">
                    {renderTeamNames(activeMatch.team2)}
                  </span>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                    selectedWinnerTeam === "team2"
                      ? "border-emerald-400 bg-emerald-500 text-slate-950"
                      : "border-slate-700 bg-slate-900"
                  }`}
                >
                  {selectedWinnerTeam === "team2" && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </button>
            </div>

            {/* Optional Score / Notes */}
            <div className="space-y-1.5">
              <label
                htmlFor="scoreNotes"
                className="block text-xs font-black uppercase tracking-wider text-slate-300"
              >
                Score / Result Notes <span className="text-slate-500">(Optional)</span>
              </label>
              <input
                id="scoreNotes"
                type="text"
                placeholder="e.g., 21-18, 21-19"
                value={scoreNotesInput}
                onChange={(e) => setScoreNotesInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 text-white rounded-xl px-4 py-3 text-sm outline-hidden font-medium placeholder:text-slate-600"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCompleteModal(false)}
                disabled={isCompleting}
                className="flex-1 py-3 px-4 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white font-bold text-sm transition cursor-pointer"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleConfirmComplete}
                disabled={isCompleting || !selectedWinnerTeam}
                className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition cursor-pointer"
              >
                {isCompleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>SAVING...</span>
                  </>
                ) : (
                  <span>CONFIRM COMPLETION</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
