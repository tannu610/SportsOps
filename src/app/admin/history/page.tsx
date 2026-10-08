"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  History,
  Search,
  Filter,
  RotateCcw,
  Trophy,
  Copy,
  Check,
  X,
  Clock,
  User,
  Eye,
  CalendarDays,
  ShieldCheck,
  ChevronRight
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

interface MatchHistoryItem {
  id: string;
  match_code: string;
  sport: string;
  category: string;
  phase: string;
  playing_area: string;
  scheduled_time: string;
  reporting_time?: string | null;
  status: "COMPLETED";
  team1_names: string;
  team2_names: string;
  players_display: string;
  referee_name: string;
  winner_id: string | null;
  winner_name: string;
  score_notes: string | null;
  completed_at: string;
}

export default function AdminMatchHistoryPage() {
  const supabase = useMemo(() => createClient(), []);

  // Data State
  const [historyItems, setHistoryItems] = useState<MatchHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<MatchHistoryItem | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState("");
  const [sportFilter, setSportFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [roundFilter, setRoundFilter] = useState("ALL");
  const [refereeFilter, setRefereeFilter] = useState("ALL");

  // Filter Options State
  const [availableSports, setAvailableSports] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableRounds, setAvailableRounds] = useState<string[]>([]);
  const [availableReferees, setAvailableReferees] = useState<string[]>([]);

  // UI state
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Time formatters
  const format12Hour = (isoString?: string | null) => {
    if (!isoString) return "-";
    try {
      return new Date(isoString).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return isoString;
    }
  };

  const formatCompletedTime = (isoString?: string | null) => {
    if (!isoString) return "-";
    try {
      const d = new Date(isoString);
      return (
        d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) +
        ", " +
        d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      );
    } catch {
      return isoString;
    }
  };

  const getReportingTime = (scheduledIso?: string | null, reportingIso?: string | null) => {
    if (reportingIso) return format12Hour(reportingIso);
    if (!scheduledIso) return "-";
    try {
      const date = new Date(scheduledIso);
      date.setMinutes(date.getMinutes() - 10);
      return format12Hour(date.toISOString());
    } catch {
      return "-";
    }
  };

  const handleCopyCode = (code: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Fetch match history data from backend API
  const fetchMatchHistory = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch("/api/admin/history");
      const data = await res.json();

      if (res.ok && data.success) {
        setHistoryItems(data.history || []);
        if (data.filters) {
          setAvailableSports(data.filters.sports || []);
          setAvailableCategories(data.filters.categories || []);
          setAvailableRounds(data.filters.rounds || []);
          setAvailableReferees(data.filters.referees || []);
        }
      }
    } catch (err) {
      console.error("Error loading match history:", err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatchHistory();

    // Supabase Realtime subscription to matches table
    const channel = supabase
      .channel("admin_match_history_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        () => fetchMatchHistory(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMatchHistory, supabase]);

  // Dynamic category options based on selected sport
  const filteredCategoryOptions = useMemo(() => {
    if (sportFilter === "ALL") return availableCategories;
    const catsForSport = new Set<string>();
    historyItems
      .filter((m) => m.sport.toLowerCase() === sportFilter.toLowerCase())
      .forEach((m) => catsForSport.add(m.category));
    return Array.from(catsForSport).sort();
  }, [sportFilter, availableCategories, historyItems]);

  // Filtered match records
  const filteredMatches = useMemo(() => {
    return historyItems.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesCode = item.match_code.toLowerCase().includes(q);
        const matchesPlayers = item.players_display.toLowerCase().includes(q);
        const matchesReferee = item.referee_name.toLowerCase().includes(q);
        const matchesWinner = item.winner_name.toLowerCase().includes(q);
        if (!matchesCode && !matchesPlayers && !matchesReferee && !matchesWinner) {
          return false;
        }
      }

      // 2. Sport Filter
      if (sportFilter !== "ALL" && item.sport.toLowerCase() !== sportFilter.toLowerCase()) {
        return false;
      }

      // 3. Category Filter
      if (categoryFilter !== "ALL" && item.category.toLowerCase() !== categoryFilter.toLowerCase()) {
        return false;
      }

      // 4. Round Filter
      if (roundFilter !== "ALL" && item.phase.toLowerCase() !== roundFilter.toLowerCase()) {
        return false;
      }

      // 5. Referee Filter
      if (refereeFilter !== "ALL" && item.referee_name.toLowerCase() !== refereeFilter.toLowerCase()) {
        return false;
      }

      return true;
    });
  }, [historyItems, searchQuery, sportFilter, categoryFilter, roundFilter, refereeFilter]);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    sportFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    roundFilter !== "ALL" ||
    refereeFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setSportFilter("ALL");
    setCategoryFilter("ALL");
    setRoundFilter("ALL");
    setRefereeFilter("ALL");
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                Match History
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Verified historical records of completed matches and referee results.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-zinc-700">
            Total Completed: {historyItems.length}
          </span>
        </div>
      </div>

      {/* Main Table / List Container */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        {/* Filters Bar */}
        <div className="p-4 border-b border-gray-200 dark:border-zinc-800 flex flex-wrap gap-3 justify-between items-center bg-gray-50/50 dark:bg-zinc-900/50">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search Match Code, player, referee..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-950 text-gray-900 dark:text-gray-100"
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Sport Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Sport:</span>
              <select
                value={sportFilter}
                onChange={(e) => {
                  setSportFilter(e.target.value);
                  setCategoryFilter("ALL");
                }}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Sports</option>
                {availableSports.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Category:</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Categories</option>
                {filteredCategoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Round Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Round:</span>
              <select
                value={roundFilter}
                onChange={(e) => setRoundFilter(e.target.value)}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Rounds</option>
                {availableRounds.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Referee Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Referee:</span>
              <select
                value={refereeFilter}
                onChange={(e) => setRefereeFilter(e.target.value)}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Referees</option>
                {availableReferees.map((ref) => (
                  <option key={ref} value={ref}>
                    {ref}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition cursor-pointer"
                title="Reset all filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Table */}
        {isLoading ? (
          <div className="p-12 text-center text-gray-400 dark:text-gray-500">
            <p className="text-sm font-medium">Loading match history...</p>
          </div>
        ) : historyItems.length === 0 ? (
          /* Empty State: No completed matches at all */
          <div className="p-16 text-center space-y-3">
            <div className="inline-flex p-4 rounded-2xl bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-gray-500 mb-1">
              <Trophy className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              No completed matches yet.
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              Completed matches with referee results will appear here.
            </p>
          </div>
        ) : filteredMatches.length === 0 ? (
          /* Empty State: Filters returned 0 results */
          <div className="p-16 text-center space-y-3">
            <div className="inline-flex p-4 rounded-2xl bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-gray-500 mb-1">
              <Filter className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              No matches found.
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              Try changing your filters.
            </p>
            <div>
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          </div>
        ) : (
          /* Table of Completed Matches */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-800 bg-gray-50/75 dark:bg-zinc-800/50 text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Match Code</th>
                  <th className="py-3 px-4">Sport</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Round</th>
                  <th className="py-3 px-4">Court</th>
                  <th className="py-3 px-4">Players</th>
                  <th className="py-3 px-4">Referee</th>
                  <th className="py-3 px-4">Winner</th>
                  <th className="py-3 px-4">Result</th>
                  <th className="py-3 px-4">Match Time</th>
                  <th className="py-3 px-4">Completed At</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {filteredMatches.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedMatch(item)}
                    className="hover:bg-blue-50/40 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer group"
                  >
                    {/* Match Code */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-black text-sm text-blue-600 dark:text-blue-400 tracking-wider">
                          {item.match_code}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleCopyCode(item.match_code, e)}
                          className="p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
                          title="Copy Match Code"
                        >
                          {copiedCode === item.match_code ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Sport */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-semibold text-gray-800 dark:text-gray-200">
                      {item.sport}
                    </td>

                    {/* Category */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-700 dark:text-gray-300">
                      {item.category}
                    </td>

                    {/* Round */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-600 dark:text-gray-400 font-medium">
                      {item.phase}
                    </td>

                    {/* Play Area / Court */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-medium text-gray-900 dark:text-white">
                      {item.playing_area}
                    </td>

                    {/* Players */}
                    <td className="py-3.5 px-4 min-w-[200px] font-medium text-gray-900 dark:text-gray-100">
                      {item.players_display}
                    </td>

                    {/* Referee */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-medium text-purple-600 dark:text-purple-400">
                      {item.referee_name}
                    </td>

                    {/* Winner */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                        <Trophy className="w-3.5 h-3.5 shrink-0" />
                        <span>{item.winner_name}</span>
                      </span>
                    </td>

                    {/* Result */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono font-semibold text-gray-700 dark:text-gray-300">
                      {item.score_notes || "-"}
                    </td>

                    {/* Match Time */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-500 dark:text-gray-400 text-xs">
                      {format12Hour(item.scheduled_time)}
                    </td>

                    {/* Completed At */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-500 dark:text-gray-400 text-xs">
                      {formatCompletedTime(item.completed_at)}
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <span className="inline-flex items-center text-xs font-semibold text-blue-600 dark:text-blue-400 group-hover:translate-x-0.5 transition-transform">
                        Details <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* MODAL: MATCH HISTORY DETAILS VIEW                         */}
      {/* ======================================================== */}
      {selectedMatch && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg p-6 sm:p-7 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-gray-100 dark:border-zinc-800">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500 block">
                  MATCH CODE
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono font-black text-2xl tracking-wider text-blue-600 dark:text-blue-400">
                    {selectedMatch.match_code}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleCopyCode(selectedMatch.match_code, e)}
                    className="p-1 rounded-lg bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-300 transition"
                    title="Copy Match Code"
                  >
                    {copiedCode === selectedMatch.match_code ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                  COMPLETED
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedMatch(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Grid Information */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block">
                  SPORT
                </span>
                <span className="font-black text-gray-900 dark:text-white uppercase text-sm">
                  {selectedMatch.sport}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block">
                  PLAYING AREA
                </span>
                <span className="font-black text-blue-600 dark:text-blue-400 uppercase text-sm">
                  {selectedMatch.playing_area}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block">
                  CATEGORY
                </span>
                <span className="font-bold text-gray-800 dark:text-gray-200 text-sm">
                  {selectedMatch.category}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 block">
                  PHASE / ROUND
                </span>
                <span className="font-bold text-gray-800 dark:text-gray-200 text-sm">
                  {selectedMatch.phase}
                </span>
              </div>
            </div>

            {/* Players Display */}
            <div className="bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500 block mb-2">
                PLAYERS
              </span>
              <div className="flex items-center justify-between text-center">
                <div className="w-[42%] text-left">
                  <span className="text-[10px] font-bold uppercase text-gray-400 block">TEAM 1</span>
                  <p className="font-black text-gray-900 dark:text-white text-sm sm:text-base leading-snug">
                    {selectedMatch.team1_names}
                  </p>
                </div>

                <div className="w-[16%] flex justify-center">
                  <span className="w-7 h-7 rounded-full bg-gray-200 dark:bg-zinc-800 flex items-center justify-center text-[10px] font-black text-gray-500">
                    VS
                  </span>
                </div>

                <div className="w-[42%] text-right">
                  <span className="text-[10px] font-bold uppercase text-gray-400 block">TEAM 2</span>
                  <p className="font-black text-gray-900 dark:text-white text-sm sm:text-base leading-snug">
                    {selectedMatch.team2_names}
                  </p>
                </div>
              </div>
            </div>

            {/* Match Result & Referee Section */}
            <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/40 rounded-2xl p-4 space-y-2.5 text-xs sm:text-sm">
              <div className="flex justify-between items-center py-1 border-b border-emerald-100 dark:border-emerald-900/40">
                <span className="font-bold text-gray-600 dark:text-gray-400 uppercase text-[11px]">
                  WINNER
                </span>
                <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm flex items-center gap-1.5">
                  <Trophy className="w-4 h-4" />
                  {selectedMatch.winner_name}
                </span>
              </div>

              {selectedMatch.score_notes && (
                <div className="flex justify-between items-center py-1 border-b border-emerald-100 dark:border-emerald-900/40">
                  <span className="font-bold text-gray-600 dark:text-gray-400 uppercase text-[11px]">
                    RESULT
                  </span>
                  <span className="font-bold text-gray-900 dark:text-white font-mono">
                    {selectedMatch.score_notes}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center py-1 border-b border-emerald-100 dark:border-emerald-900/40">
                <span className="font-bold text-gray-600 dark:text-gray-400 uppercase text-[11px]">
                  OFFICIAL REFEREE
                </span>
                <span className="font-bold text-purple-600 dark:text-purple-400">
                  {selectedMatch.referee_name}
                </span>
              </div>

              <div className="flex justify-between items-center py-1">
                <span className="font-bold text-gray-600 dark:text-gray-400 uppercase text-[11px]">
                  COMPLETED AT
                </span>
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {formatCompletedTime(selectedMatch.completed_at)}
                </span>
              </div>
            </div>

            {/* Time Details */}
            <div className="grid grid-cols-2 gap-3 text-xs pt-1 border-t border-gray-100 dark:border-zinc-800 text-gray-500">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                  MATCH TIME
                </span>
                <span className="font-bold text-gray-800 dark:text-gray-200">
                  {format12Hour(selectedMatch.scheduled_time)}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                  REPORT BY
                </span>
                <span className="font-bold text-gray-800 dark:text-gray-200">
                  {getReportingTime(selectedMatch.scheduled_time, selectedMatch.reporting_time)}
                </span>
              </div>
            </div>

            {/* Close Button */}
            <div>
              <button
                type="button"
                onClick={() => setSelectedMatch(null)}
                className="w-full py-3 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-gray-200 font-bold rounded-xl text-sm transition cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
