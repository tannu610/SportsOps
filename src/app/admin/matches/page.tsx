"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Clock,
  AlertTriangle,
  X,
  Trash2,
  CheckCircle2,
  PlayCircle,
  XCircle,
  Trophy,
  Bell,
  Layers,
  ChevronRight,
  ShieldCheck,
  Check,
  MoreVertical,
  Activity,
  CalendarDays,
  User,
  Users
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { DEFAULT_SPORTS_CONFIG, SPORT_FACILITY_DEFAULTS } from "@/utils/eventConfig";

const PHASES = ["Round 1", "Round 2", "Round 3", "Quarter Final", "Semi Final", "Final"];

type Player = {
  id: string;
  employee_id: string;
  name: string;
  contact_info?: string;
  status: string;
  sport: string;
  category?: string;
  current_round?: number;
};

type Match = {
  id: string;
  sport: string;
  category: string;
  phase: string;
  playing_area: string;
  scheduled_time: string;
  reporting_time?: string;
  status: string;
  team1_p1: Player | null;
  team1_p2: Player | null;
  team2_p1: Player | null;
  team2_p2: Player | null;
};

type SportFacilityMap = Record<
  string,
  {
    areaLabel: string;
    areas: string[];
    categories: string[];
    facilityCount: number;
    facilityType: string;
  }
>;

export default function PlayAreaManagementPage() {
  const supabase = useMemo(() => createClient(), []);

  const [isLoading, setIsLoading] = useState(true);
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState("Sports Day 2026");

  // Dynamic Event Configuration & Facility mapping
  const [sportConfigs, setSportConfigs] = useState<SportFacilityMap>({
    Badminton: {
      areaLabel: "Court",
      areas: ["Court 1", "Court 2", "Court 3", "Court 4", "Court 5", "Court 6"],
      categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"],
      facilityCount: 6,
      facilityType: "Courts"
    }
  });

  const [activeSport, setActiveSport] = useState<string>("Badminton");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "FREE" | "SCHEDULED" | "LIVE">("ALL");

  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  // Modals state
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [finishingMatch, setFinishingMatch] = useState<{ match: Match; isWalkover: boolean } | null>(null);
  const [managingMatch, setManagingMatch] = useState<Match | null>(null);

  // Form State for Create Match
  const [formSport, setFormSport] = useState("Badminton");
  const [formCategory, setFormCategory] = useState("Men's Singles");
  const [formPhase, setFormPhase] = useState("Round 1");
  const [formArea, setFormArea] = useState("Court 1");
  const [t1p1, setT1p1] = useState("");
  const [t1p2, setT1p2] = useState("");
  const [t2p1, setT2p1] = useState("");
  const [t2p2, setT2p2] = useState("");
  const [matchTime, setMatchTime] = useState("");

  // Load dynamic event configuration and database data
  async function loadAllData() {
    try {
      // 1. Fetch event configuration
      const configRes = await fetch("/api/admin/event/config");
      const configData = await configRes.json();

      let currentEventId = configData.event?.id;
      if (configData.event) {
        setEventName(configData.event.name || "Sports Day 2026");
        setEventId(currentEventId);
      }

      if (configData.configuration?.sports) {
        const dynamicMap: SportFacilityMap = {};
        const sports = configData.configuration.sports;

        Object.entries(sports).forEach(([sName, sCfg]: [string, any]) => {
          if (sCfg.enabled) {
            const count = Math.max(1, sCfg.facilityCount || 1);
            const unit =
              sCfg.facilityUnit ||
              (sName === "Table Tennis"
                ? "Table"
                : sName === "Cricket" || sName === "Football"
                ? "Ground"
                : "Court");
            const generatedAreas = Array.from({ length: count }, (_, i) => `${unit} ${i + 1}`);

            dynamicMap[sName] = {
              areaLabel: unit,
              areas: generatedAreas,
              categories: sCfg.categories && sCfg.categories.length > 0 ? sCfg.categories : ["Open"],
              facilityCount: count,
              facilityType: sCfg.facilityType || "Courts"
            };
          }
        });

        if (Object.keys(dynamicMap).length > 0) {
          setSportConfigs(dynamicMap);
          // Retain active sport if available, otherwise switch to first enabled sport
          setActiveSport((prev) => (dynamicMap[prev] ? prev : Object.keys(dynamicMap)[0]));
        }
      }

      // If eventId wasn't returned from config, fetch from events table directly
      if (!currentEventId) {
        const { data: events } = await supabase.from("events").select("id, name").limit(1);
        if (events && events.length > 0) {
          currentEventId = events[0].id;
          setEventId(currentEventId);
          setEventName(events[0].name || "Sports Day 2026");
        }
      }

      if (currentEventId) {
        // 2. Fetch players
        const { data: dbPlayers } = await supabase
          .from("players")
          .select("id, employee_id, name, contact_info, status, sport, category, current_round")
          .eq("event_id", currentEventId)
          .neq("status", "REGISTERED")
          .neq("status", "ABSENT")
          .order("name");

        if (dbPlayers) setPlayers(dbPlayers);

        // 3. Fetch matches
        const { data: dbMatches } = await supabase
          .from("matches")
          .select(`
            id, sport, category, phase, playing_area, scheduled_time, reporting_time, status,
            team1_p1:players!fk_t1p1(id, employee_id, name, contact_info, status),
            team1_p2:players!fk_t1p2(id, employee_id, name, contact_info, status),
            team2_p1:players!fk_t2p1(id, employee_id, name, contact_info, status),
            team2_p2:players!fk_t2p2(id, employee_id, name, contact_info, status)
          `)
          .eq("event_id", currentEventId)
          .order("created_at", { ascending: false });

        if (dbMatches) setMatches(dbMatches as any);
      }
    } catch (err) {
      console.error("Error loading Play Area Management data:", err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAllData();

    // Supabase Realtime subscriptions
    const channel = supabase
      .channel("court_management_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, () => loadAllData())
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => loadAllData())
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => loadAllData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Handle sport switch in Create Match modal
  const handleFormSportChange = (newSport: string) => {
    setFormSport(newSport);
    const config = sportConfigs[newSport] || Object.values(sportConfigs)[0];
    if (config) {
      setFormCategory(config.categories[0] || "Open");
      setFormArea(config.areas[0] || "Court 1");
    }
  };

  // Open Create Match modal with preselected court
  const openCreateModalForCourt = (courtName: string) => {
    setFormSport(activeSport);
    const config = sportConfigs[activeSport] || Object.values(sportConfigs)[0];
    if (config) {
      setFormCategory(config.categories[0] || "Open");
      setFormArea(courtName);
    }
    // Set default match time to 15 mins from now
    const now = new Date();
    now.setMinutes(now.getMinutes() + 15);
    const hours = String(now.getHours()).padStart(2, "0");
    const mins = String(now.getMinutes()).padStart(2, "0");
    setMatchTime(`${hours}:${mins}`);

    setIsCreating(true);
  };

  const getPlayerIdByEmpId = (empId: string, matchSport: string, matchCategory: string) => {
    if (!empId) return null;
    const empMatches = players.filter((pl) => pl.employee_id.toUpperCase() === empId.toUpperCase());
    if (empMatches.length === 0) return null;

    let p = empMatches.find((pl) => (pl.category || "").toLowerCase() === matchCategory.toLowerCase());
    if (!p) p = empMatches.find((pl) => pl.sport.toLowerCase() === matchCategory.toLowerCase());
    if (!p) p = empMatches.find((pl) => pl.sport.toLowerCase().includes(matchCategory.toLowerCase()));
    if (!p) p = empMatches.find((pl) => pl.sport.toLowerCase().includes(matchSport.toLowerCase()));
    if (!p) p = empMatches[0];

    return p ? p.id : null;
  };

  // Create match handler
  const handleCreateMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !eventId || !t1p1 || !t2p1 || !matchTime) return;

    const id_t1p1 = getPlayerIdByEmpId(t1p1, formSport, formCategory);
    const id_t2p1 = getPlayerIdByEmpId(t2p1, formSport, formCategory);
    const id_t1p2 = getPlayerIdByEmpId(t1p2, formSport, formCategory);
    const id_t2p2 = getPlayerIdByEmpId(t2p2, formSport, formCategory);

    if (!id_t1p1 || !id_t2p1) {
      alert("Invalid primary players selected. Please ensure Employee IDs are correct and they are checked in.");
      return;
    }

    const selectedIds = [id_t1p1, id_t2p1, id_t1p2, id_t2p2].filter((id): id is string => Boolean(id));
    const uniqueIds = new Set(selectedIds);
    if (selectedIds.length !== uniqueIds.size) {
      alert("A player cannot be selected more than once in the same match.");
      return;
    }

    const date = new Date();
    const [hours, minutes] = matchTime.split(":");
    date.setHours(Number(hours), Number(minutes), 0, 0);
    const matchTimestamp = date.toISOString();

    // 1. Conflict check: Same player already occupied at this time across all courts
    const hasPlayerConflict = matches.some((m) => {
      if (m.status === "COMPLETED" || m.status === "WALKOVER" || m.status === "CANCELLED") return false;
      if (m.scheduled_time !== matchTimestamp) return false;
      const matchPlayerIds = [m.team1_p1?.id, m.team1_p2?.id, m.team2_p1?.id, m.team2_p2?.id].filter((id): id is string =>
        Boolean(id)
      );
      return selectedIds.some((id) => matchPlayerIds.includes(id));
    });

    if (hasPlayerConflict) {
      alert("Player conflict: one or more players already have a match scheduled at this time.");
      return;
    }

    // 2. Conflict check: Court already occupied at this exact time
    const hasCourtConflict = matches.some((m) => {
      if (m.status === "COMPLETED" || m.status === "WALKOVER" || m.status === "CANCELLED") return false;
      return m.playing_area === formArea && m.scheduled_time === matchTimestamp;
    });

    if (hasCourtConflict) {
      alert(`Court conflict: ${formArea} is already occupied at this time.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/matches/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          sport: formSport,
          category: formCategory,
          phase: formPhase,
          playingArea: formArea,
          scheduledTime: matchTimestamp,
          team1_p1_id: id_t1p1,
          team1_p2_id: id_t1p2,
          team2_p1_id: id_t2p1,
          team2_p2_id: id_t2p2
        })
      });

      const result = await res.json();
      if (!res.ok) {
        if (result.error?.includes("Player conflict")) {
          alert("Player conflict: one or more players already have a match scheduled at this time.");
          return;
        }
        if (result.error?.includes("already exists") || result.error?.includes("unique")) {
          alert("This match already exists.");
          return;
        }
        alert("Error creating match: " + (result.error || "Failed to create match"));
        return;
      }

      // Automatically trigger notifications for all match players
      if (result.match?.id) {
        try {
          await fetch("/api/push/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ matchId: result.match.id })
          });
        } catch (notifyErr) {
          console.error("Notification trigger error:", notifyErr);
        }
      }

      setIsCreating(false);
      setT1p1("");
      setT2p1("");
      setT1p2("");
      setT2p2("");
      setMatchTime("");
      await loadAllData();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Start match LIVE immediately
  const startMatchLive = async (matchId: string) => {
    const targetMatch = matches.find((m) => m.id === matchId);
    const targetPlayerIds = [
      targetMatch?.team1_p1?.id,
      targetMatch?.team1_p2?.id,
      targetMatch?.team2_p1?.id,
      targetMatch?.team2_p2?.id,
    ].filter(Boolean) as string[];

    // Optimistic UI update
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: "LIVE" } : m)));
    if (targetPlayerIds.length > 0) {
      setPlayers((prev) =>
        prev.map((p) =>
          targetPlayerIds.includes(p.id) ? { ...p, previous_status: p.status, status: "PLAYING" } : p
        )
      );
    }

    try {
      const res = await fetch("/api/matches/start-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start match live");
      }
      loadAllData();
    } catch (err: any) {
      alert("Error starting match live: " + err.message);
      loadAllData();
    }
  };

  // Update match status
  const updateMatchStatus = async (matchId: string, newStatus: string) => {
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: newStatus } : m)));
    const { error } = await supabase.from("matches").update({ status: newStatus }).eq("id", matchId);
    if (error) {
      alert("Error: " + error.message);
      loadAllData();
    }
  };

  // Delete match and rollback players safely
  const deleteMatch = async (matchId: string) => {
    if (!confirm("Are you sure you want to delete this match? All players will revert to their previous status and this play area will become FREE."))
      return;
    const { error } = await supabase.rpc("delete_match_and_rollback", { p_match_id: matchId });
    if (error) {
      alert("Error deleting match: " + error.message);
    } else {
      setManagingMatch(null);
      loadAllData();
    }
  };

  // Submit match completion / walkover
  const submitMatchResult = async (winningTeam: "team1" | "team2") => {
    if (!finishingMatch) return;
    try {
      const res = await fetch("/api/matches/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: finishingMatch.match.id,
          winningTeam,
          isWalkover: finishingMatch.isWalkover || false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to complete match");
      }
      setFinishingMatch(null);
      setManagingMatch(null);
      loadAllData();
    } catch (err: any) {
      alert("Error completing match: " + err.message);
    }
  };

  const format12Hour = (isoString?: string) => {
    if (!isoString) return "";
    return new Date(isoString).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  };

  // Compute reporting time (10 minutes before scheduled time if not set)
  const getReportingTime = (scheduledIso: string, reportingIso?: string) => {
    if (reportingIso) return format12Hour(reportingIso);
    const date = new Date(scheduledIso);
    date.setMinutes(date.getMinutes() - 10);
    return format12Hour(date.toISOString());
  };

  // Individual player response formatter
  const getPlayerResponse = (player: Player | null) => {
    if (!player) return null;
    if (player.status === "UNAVAILABLE" || player.status === "NO_SHOW" || player.status === "ABSENT") {
      return {
        label: "✕ Not Coming",
        colorClass: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900",
        isUnavailable: true
      };
    }
    if (
      player.status === "AVAILABLE" ||
      player.status === "PRESENT" ||
      player.status === "CONFIRMED" ||
      player.status === "PLAYER_CONFIRMED"
    ) {
      return {
        label: "✓ Coming",
        colorClass: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900",
        isComing: true
      };
    }
    return {
      label: "⏳ Waiting",
      colorClass: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900",
      isWaiting: true
    };
  };

  // Get active configuration for current sport
  const currentSportConfig = sportConfigs[activeSport] || Object.values(sportConfigs)[0] || {
    areaLabel: "Court",
    areas: ["Court 1", "Court 2", "Court 3", "Court 4", "Court 5", "Court 6"],
    categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"],
    facilityCount: 6,
    facilityType: "Courts"
  };

  const currentCourtList = currentSportConfig.areas;

  // Derive status and matches for each court card
  const courtData = currentCourtList.map((courtName) => {
    // Matches associated with this court
    const courtMatches = matches.filter(
      (m) => m.playing_area.toLowerCase() === courtName.toLowerCase() && m.sport.toLowerCase() === activeSport.toLowerCase()
    );

    // 1. LIVE match takes highest priority
    const liveMatch = courtMatches.find((m) => m.status === "LIVE");
    if (liveMatch) {
      return {
        courtName,
        status: "LIVE" as const,
        match: liveMatch,
        hasPlayerUnavailable: false
      };
    }

    // 2. SCHEDULED / NOTIFIED / READY / NO-SHOW PENDING match
    const activeScheduled = courtMatches
      .filter((m) =>
        ["SCHEDULED", "NOTIFIED", "PLAYER_CONFIRMED", "READY", "NO-SHOW PENDING", "DELAYED", "PLAYER_UNAVAILABLE"].includes(
          m.status
        )
      )
      .sort((a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime());

    if (activeScheduled.length > 0) {
      const scheduledMatch = activeScheduled[0];
      const matchPlayers = [
        scheduledMatch.team1_p1,
        scheduledMatch.team1_p2,
        scheduledMatch.team2_p1,
        scheduledMatch.team2_p2
      ].filter(Boolean) as Player[];

      const hasUnavailable =
        scheduledMatch.status === "PLAYER_UNAVAILABLE" || matchPlayers.some((p) => p.status === "UNAVAILABLE");

      return {
        courtName,
        status: "SCHEDULED" as const,
        match: scheduledMatch,
        hasPlayerUnavailable: hasUnavailable,
        queuedCount: activeScheduled.length - 1
      };
    }

    // 3. Last COMPLETED match (if any)
    const completedMatches = courtMatches
      .filter((m) => m.status === "COMPLETED" || m.status === "WALKOVER")
      .sort((a, b) => new Date(b.scheduled_time).getTime() - new Date(a.scheduled_time).getTime());

    return {
      courtName,
      status: "FREE" as const,
      match: null,
      lastCompletedMatch: completedMatches[0] || null,
      hasPlayerUnavailable: false
    };
  });

  // Summary counts
  const totalCourtsCount = courtData.length;
  const freeCourtsCount = courtData.filter((c) => c.status === "FREE").length;
  const scheduledCourtsCount = courtData.filter((c) => c.status === "SCHEDULED").length;
  const liveCourtsCount = courtData.filter((c) => c.status === "LIVE").length;
  const attentionCount = courtData.filter((c) => c.hasPlayerUnavailable || c.match?.status === "NO-SHOW PENDING").length;

  // Filtered courts based on statusFilter
  const filteredCourts = courtData.filter((c) => {
    if (statusFilter === "FREE") return c.status === "FREE";
    if (statusFilter === "SCHEDULED") return c.status === "SCHEDULED";
    if (statusFilter === "LIVE") return c.status === "LIVE";
    return true;
  });

  const formActiveConfig = sportConfigs[formSport] || currentSportConfig;
  const formIsDoubles = formCategory.includes("Doubles");

  const eligiblePlayers = players.filter((p) => {
    const matchesCategory =
      p.category === formCategory ||
      p.sport === formCategory ||
      p.sport === `${formSport} - ${formCategory}` ||
      p.sport === formSport;
    if (!matchesCategory) return false;

    // In V1, SportsOps does not enforce automatic bracket qualifications or elimination locks.
    // Completed players reset to REGISTERED and remain selectable by the committee for any round/phase.
    return p.status !== "PLAYING";
  });

  return (
    <div className="space-y-8 pb-20">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-gradient-to-r from-blue-900 via-indigo-900 to-purple-900 p-8 rounded-[2rem] shadow-xl text-white">
        <div>
          <div className="flex items-center gap-2 text-indigo-300 text-xs font-black uppercase tracking-widest mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            {eventName} • Match-Day Operations
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Trophy className="w-8 h-8 text-amber-400" /> Play Area Management
          </h1>
          <p className="text-indigo-200 font-medium mt-1 text-sm">
            Real-time play area allocation, live match progress, and player response tracking.
          </p>
        </div>

        <button
          onClick={() => openCreateModalForCourt(currentCourtList[0] || "Court 1")}
          className="flex items-center px-6 py-3.5 bg-white text-indigo-900 rounded-2xl text-sm font-black hover:bg-gray-100 shadow-xl shadow-indigo-950/40 transition-all w-full md:w-auto justify-center hover:scale-105 active:scale-95"
        >
          <Plus className="w-5 h-5 mr-2" /> Create Match
        </button>
      </div>

      {/* 2. Sport Tabs Switcher (Dynamic from Event Configuration) */}
      {Object.keys(sportConfigs).length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {Object.entries(sportConfigs).map(([sName, cfg]) => {
            const isSelected = activeSport === sName;
            return (
              <button
                key={sName}
                type="button"
                onClick={() => setActiveSport(sName)}
                className={`px-5 py-3 rounded-2xl text-sm font-black transition-all flex items-center gap-2.5 whitespace-nowrap shadow-sm ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-blue-500/25"
                    : "bg-white dark:bg-zinc-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 border border-gray-200 dark:border-zinc-800"
                }`}
              >
                <span>{sName}</span>
                <span
                  className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                    isSelected ? "bg-blue-700 text-white" : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {cfg.facilityCount} {cfg.facilityType}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 3. Summary Counters & Status Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <button
          onClick={() => setStatusFilter("ALL")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            statusFilter === "ALL"
              ? "bg-white dark:bg-zinc-900 border-indigo-500 shadow-md ring-2 ring-indigo-500/20"
              : "bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-gray-300"
          }`}
        >
          <div className="text-xs font-black uppercase tracking-wider text-gray-400">Total {currentSportConfig.facilityType}</div>
          <div className="text-2xl font-black mt-1 text-gray-900 dark:text-white">{totalCourtsCount}</div>
        </button>

        <button
          onClick={() => setStatusFilter("FREE")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            statusFilter === "FREE"
              ? "bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-500 shadow-md ring-2 ring-emerald-500/20"
              : "bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-gray-300"
          }`}
        >
          <div className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Free
          </div>
          <div className="text-2xl font-black mt-1 text-emerald-700 dark:text-emerald-300">{freeCourtsCount}</div>
        </button>

        <button
          onClick={() => setStatusFilter("SCHEDULED")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            statusFilter === "SCHEDULED"
              ? "bg-amber-50/50 dark:bg-amber-950/30 border-amber-500 shadow-md ring-2 ring-amber-500/20"
              : "bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-gray-300"
          }`}
        >
          <div className="text-xs font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Scheduled
          </div>
          <div className="text-2xl font-black mt-1 text-amber-700 dark:text-amber-300">{scheduledCourtsCount}</div>
        </button>

        <button
          onClick={() => setStatusFilter("LIVE")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            statusFilter === "LIVE"
              ? "bg-purple-50/50 dark:bg-purple-950/30 border-purple-500 shadow-md ring-2 ring-purple-500/20"
              : "bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-gray-300"
          }`}
        >
          <div className="text-xs font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-ping" /> Live
          </div>
          <div className="text-2xl font-black mt-1 text-purple-700 dark:text-purple-300">{liveCourtsCount}</div>
        </button>
      </div>

      {/* Attention Alert Banner if players are unavailable */}
      {attentionCount > 0 && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 p-4 rounded-2xl flex items-center gap-3 text-rose-800 dark:text-rose-300 shadow-sm animate-in fade-in duration-200">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600" />
          <div className="text-sm font-bold flex-1">
            {attentionCount} play area{attentionCount > 1 ? "s" : ""} require admin attention (player clicked "I'M UNAVAILABLE" or no-show pending).
          </div>
        </div>
      )}

      {/* 4. Responsive Court Cards Grid */}
      {isLoading ? (
        <div className="py-20 text-center text-gray-400 font-medium">Loading {currentSportConfig.facilityType}...</div>
      ) : filteredCourts.length === 0 ? (
        <div className="py-16 text-center border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl text-gray-400 font-bold">
          No courts matching current filter ({statusFilter}).
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCourts.map((court) => {
            const { courtName, status, match, hasPlayerUnavailable, lastCompletedMatch } = court;

            // STATE 1: FREE COURT
            if (status === "FREE") {
              return (
                <div
                  key={courtName}
                  className="bg-white dark:bg-zinc-900 rounded-3xl border-2 border-emerald-200/60 dark:border-emerald-900/30 p-6 flex flex-col justify-between shadow-sm hover:shadow-md transition-all hover:border-emerald-400"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-zinc-800">
                      <span className="text-base font-black text-gray-900 dark:text-white uppercase tracking-wider">
                        {courtName}
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        🟢 FREE
                      </span>
                    </div>

                    {/* Body */}
                    <div className="py-10 text-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <h4 className="text-base font-black text-gray-800 dark:text-gray-200">No Match Scheduled</h4>
                      <p className="text-xs text-gray-400 font-medium">Court is open and ready for play.</p>

                      {lastCompletedMatch && (
                        <div className="pt-2 text-[11px] font-bold text-gray-400">
                          Last: {lastCompletedMatch.team1_p1?.name} vs {lastCompletedMatch.team2_p1?.name} (Done)
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action */}
                  <div className="pt-4 border-t border-gray-100 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => openCreateModalForCourt(courtName)}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" /> Create Match
                    </button>
                  </div>
                </div>
              );
            }

            // STATE 2: SCHEDULED COURT
            if (status === "SCHEDULED" && match) {
              const respT1P1 = getPlayerResponse(match.team1_p1);
              const respT1P2 = getPlayerResponse(match.team1_p2);
              const respT2P1 = getPlayerResponse(match.team2_p1);
              const respT2P2 = getPlayerResponse(match.team2_p2);

              const reportTimeFormatted = getReportingTime(match.scheduled_time, match.reporting_time);
              const matchTimeFormatted = format12Hour(match.scheduled_time);

              return (
                <div
                  key={courtName}
                  className={`bg-white dark:bg-zinc-900 rounded-3xl border-2 p-6 flex flex-col justify-between shadow-sm hover:shadow-md transition-all ${
                    hasPlayerUnavailable
                      ? "border-rose-400 dark:border-rose-800 bg-rose-50/20 shadow-rose-100/50"
                      : "border-amber-200/80 dark:border-amber-900/40"
                  }`}
                >
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
                      <span className="text-base font-black text-gray-900 dark:text-white uppercase tracking-wider">
                        {courtName}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border ${
                          hasPlayerUnavailable
                            ? "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 animate-pulse"
                            : "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        {hasPlayerUnavailable ? "⚠️ ACTION REQ" : "🟡 SCHEDULED"}
                      </span>
                    </div>

                    {/* Sport, Category, Round banner */}
                    <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider">
                      <span className="text-indigo-600 dark:text-indigo-400">
                        {match.sport} • {match.category}
                      </span>
                      <span className="bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-lg text-[10px]">
                        {match.phase}
                      </span>
                    </div>

                    {/* Matchup & Player Responses */}
                    <div className="space-y-3 bg-gray-50/70 dark:bg-zinc-800/40 p-4 rounded-2xl">
                      {/* Team 1 */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-blue-600 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600" /> Team 1
                        </div>
                        <div className="flex items-center justify-between text-xs font-bold text-gray-800 dark:text-gray-200">
                          <span className="truncate">{match.team1_p1?.name}</span>
                          {respT1P1 && (
                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border ${respT1P1.colorClass}`}>
                              {respT1P1.label}
                            </span>
                          )}
                        </div>
                        {match.team1_p2 && (
                          <div className="flex items-center justify-between text-xs font-bold text-gray-800 dark:text-gray-200">
                            <span className="truncate">{match.team1_p2?.name}</span>
                            {respT1P2 && (
                              <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border ${respT1P2.colorClass}`}>
                                {respT1P2.label}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* VS Separator */}
                      <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest justify-center">
                        <div className="h-px bg-gray-200 dark:bg-zinc-700 flex-1" />
                        VS
                        <div className="h-px bg-gray-200 dark:bg-zinc-700 flex-1" />
                      </div>

                      {/* Team 2 */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-rose-600 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-600" /> Team 2
                        </div>
                        <div className="flex items-center justify-between text-xs font-bold text-gray-800 dark:text-gray-200">
                          <span className="truncate">{match.team2_p1?.name}</span>
                          {respT2P1 && (
                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border ${respT2P1.colorClass}`}>
                              {respT2P1.label}
                            </span>
                          )}
                        </div>
                        {match.team2_p2 && (
                          <div className="flex items-center justify-between text-xs font-bold text-gray-800 dark:text-gray-200">
                            <span className="truncate">{match.team2_p2?.name}</span>
                            {respT2P2 && (
                              <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border ${respT2P2.colorClass}`}>
                                {respT2P2.label}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Time Details */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-bold bg-white dark:bg-zinc-800/80 p-3 rounded-xl border border-gray-100 dark:border-zinc-800">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 block font-semibold">
                          Report By
                        </span>
                        <span className="text-amber-600 font-extrabold">{reportTimeFormatted}</span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 block font-semibold">
                          Match Time
                        </span>
                        <span className="text-indigo-600 font-extrabold">{matchTimeFormatted}</span>
                      </div>
                    </div>

                    {hasPlayerUnavailable && (
                      <div className="p-2.5 bg-rose-100/70 dark:bg-rose-950/60 rounded-xl text-[11px] font-black text-rose-800 dark:text-rose-300 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                        <span>Player is unavailable. Reschedule or walkover required.</span>
                      </div>
                    )}
                  </div>

                  {/* Footer Actions */}
                  <div className="pt-4 border-t border-gray-100 dark:border-zinc-800 flex gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => startMatchLive(match.id)}
                      className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-1.5"
                    >
                      <PlayCircle className="w-4 h-4" /> START LIVE
                    </button>
                    <button
                      type="button"
                      onClick={() => setManagingMatch(match)}
                      className="px-4 py-3 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 font-black text-xs uppercase tracking-widest rounded-xl transition-colors"
                    >
                      MANAGE
                    </button>
                  </div>
                </div>
              );
            }

            // STATE 3: LIVE COURT
            if (status === "LIVE" && match) {
              return (
                <div
                  key={courtName}
                  className="bg-white dark:bg-zinc-900 rounded-3xl border-2 border-emerald-500 p-6 flex flex-col justify-between shadow-lg shadow-emerald-500/10 relative overflow-hidden"
                >
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
                      <span className="text-base font-black text-gray-900 dark:text-white uppercase tracking-wider">
                        {courtName}
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-rose-500 text-white animate-pulse flex items-center gap-1.5 shadow-sm shadow-rose-200">
                        <span className="w-2 h-2 rounded-full bg-white animate-ping" /> LIVE
                      </span>
                    </div>

                    {/* Sport & Category */}
                    <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      <span>
                        {match.sport} • {match.category}
                      </span>
                      <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 px-2 py-0.5 rounded-lg text-[10px]">
                        {match.phase}
                      </span>
                    </div>

                    {/* Matchup */}
                    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-zinc-800 dark:to-zinc-800/60 p-4 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between text-sm font-black text-blue-900 dark:text-blue-300">
                        <span>{match.team1_p1?.name} {match.team1_p2 ? `& ${match.team1_p2.name}` : ''}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 px-2 py-0.5 rounded">Team 1</span>
                      </div>
                      <div className="text-center font-black text-xs text-gray-400 tracking-widest uppercase">VS</div>
                      <div className="flex items-center justify-between text-sm font-black text-rose-900 dark:text-rose-300">
                        <span>{match.team2_p1?.name} {match.team2_p2 ? `& ${match.team2_p2.name}` : ''}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800 px-2 py-0.5 rounded">Team 2</span>
                      </div>
                    </div>

                    <div className="text-xs font-bold text-gray-500 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-emerald-600" /> Match in progress (Scheduled: {format12Hour(match.scheduled_time)})
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="pt-4 border-t border-gray-100 dark:border-zinc-800 flex gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setFinishingMatch({ match, isWalkover: false })}
                      className="flex-1 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" /> COMPLETE MATCH
                    </button>
                    <button
                      type="button"
                      onClick={() => setManagingMatch(match)}
                      className="px-4 py-3.5 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 font-black text-xs uppercase tracking-widest rounded-xl transition-colors"
                    >
                      MANAGE
                    </button>
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}

      {/* 5. CREATE MATCH MODAL */}
      {isCreating && (
        <div className="fixed inset-0 bg-indigo-950/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-8 sm:p-10 w-full max-w-3xl shadow-2xl relative border border-gray-100 dark:border-zinc-800 max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="absolute top-6 right-6 text-gray-400 hover:text-gray-900 dark:hover:text-white p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <h2 className="text-2xl sm:text-3xl font-black mb-8 text-gray-900 dark:text-white flex items-center gap-3">
              <span className="bg-indigo-100 text-indigo-600 p-2 rounded-xl">
                <Plus className="w-6 h-6" />
              </span>
              Create Match on {formArea}
            </h2>

            <form onSubmit={handleCreateMatch} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Sport</label>
                  <select
                    value={formSport}
                    onChange={(e) => handleFormSportChange(e.target.value)}
                    className="w-full p-3.5 border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {Object.keys(sportConfigs).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Phase / Round</label>
                  <select
                    value={formPhase}
                    onChange={(e) => setFormPhase(e.target.value)}
                    className="w-full p-3.5 border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {PHASES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Category</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full p-3.5 border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {formActiveConfig.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                    {formActiveConfig.areaLabel}
                  </label>
                  <select
                    value={formArea}
                    onChange={(e) => setFormArea(e.target.value)}
                    className="w-full p-3.5 border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {formActiveConfig.areas.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Teams Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Team 1 */}
                <div className="space-y-4 bg-blue-50/60 dark:bg-blue-950/30 p-5 rounded-2xl border border-blue-100 dark:border-blue-900/40">
                  <h3 className="font-black text-xs text-blue-600 tracking-widest uppercase flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-600" /> TEAM 1
                  </h3>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Player 1 (Emp ID) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      list="eligible-players"
                      value={t1p1}
                      onChange={(e) => setT1p1(e.target.value)}
                      placeholder="Enter Employee ID..."
                      className="w-full p-3 border border-blue-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-xl font-bold text-sm text-blue-900 dark:text-blue-200 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {formIsDoubles && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Player 2 (Emp ID) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        required
                        type="text"
                        list="eligible-players"
                        value={t1p2}
                        onChange={(e) => setT1p2(e.target.value)}
                        placeholder="Enter Employee ID..."
                        className="w-full p-3 border border-blue-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-xl font-bold text-sm text-blue-900 dark:text-blue-200 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>

                {/* Team 2 */}
                <div className="space-y-4 bg-rose-50/60 dark:bg-rose-950/30 p-5 rounded-2xl border border-rose-100 dark:border-rose-900/40">
                  <h3 className="font-black text-xs text-rose-600 tracking-widest uppercase flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-600" /> TEAM 2
                  </h3>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Player 1 (Emp ID) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      list="eligible-players"
                      value={t2p1}
                      onChange={(e) => setT2p1(e.target.value)}
                      placeholder="Enter Employee ID..."
                      className="w-full p-3 border border-rose-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-xl font-bold text-sm text-rose-900 dark:text-rose-200 outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>
                  {formIsDoubles && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Player 2 (Emp ID) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        required
                        type="text"
                        list="eligible-players"
                        value={t2p2}
                        onChange={(e) => setT2p2(e.target.value)}
                        placeholder="Enter Employee ID..."
                        className="w-full p-3 border border-rose-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-xl font-bold text-sm text-rose-900 dark:text-rose-200 outline-none focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Match Time */}
              <div className="space-y-1.5 max-w-xs">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  Match Time <span className="text-rose-500">*</span>
                </label>
                <input
                  type="time"
                  required
                  value={matchTime}
                  onChange={(e) => setMatchTime(e.target.value)}
                  className="w-full p-3.5 border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-6 flex justify-end gap-3 border-t border-gray-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-6 py-3.5 bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-8 py-3.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-indigo-600/25 hover:bg-indigo-700 transition-all disabled:opacity-60"
                >
                  {isSubmitting ? "Creating & Notifying..." : "Create & Notify"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. MANAGE MATCH ACTIONS MODAL */}
      {managingMatch && (
        <div className="fixed inset-0 bg-indigo-950/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-[2rem] p-8 w-full max-w-md shadow-2xl border border-gray-100 dark:border-zinc-800 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
              <h3 className="text-xl font-black text-gray-900 dark:text-white">
                Manage Match on {managingMatch.playing_area}
              </h3>
              <button
                type="button"
                onClick={() => setManagingMatch(null)}
                className="text-gray-400 hover:text-gray-900 dark:hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm font-bold text-gray-700 dark:text-gray-300">
              {managingMatch.team1_p1?.name} vs {managingMatch.team2_p1?.name}
              <div className="text-xs text-gray-400 font-semibold mt-1">
                {managingMatch.sport} • {managingMatch.category} ({managingMatch.phase})
              </div>
            </div>

            <div className="space-y-3 pt-2">
              {/* Send Push Reminder */}
              <button
                type="button"
                onClick={async () => {
                  const res = await fetch("/api/push/notify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ matchId: managingMatch.id })
                  });
                  const data = await res.json();
                  alert(data.error ? `Error: ${data.error}` : `Reminder sent to ${data.count || 0} player(s).`);
                  setManagingMatch(null);
                }}
                className="w-full py-3 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-colors"
              >
                <Bell className="w-4 h-4" /> Send Reminder to Players
              </button>

              {/* Start Live if not live */}
              {managingMatch.status !== "LIVE" && (
                <button
                  type="button"
                  onClick={() => {
                    startMatchLive(managingMatch.id);
                    setManagingMatch(null);
                  }}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-colors shadow-md"
                >
                  <PlayCircle className="w-4 h-4" /> Start Match Live
                </button>
              )}

              {/* Complete Match */}
              <button
                type="button"
                onClick={() => {
                  setFinishingMatch({ match: managingMatch, isWalkover: false });
                }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-colors shadow-md"
              >
                <CheckCircle2 className="w-4 h-4" /> Declare Winner / Complete
              </button>

              {/* Confirm Walkover */}
              <button
                type="button"
                onClick={() => {
                  setFinishingMatch({ match: managingMatch, isWalkover: true });
                }}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-colors"
              >
                <AlertTriangle className="w-4 h-4" /> Confirm Walkover
              </button>

              {/* Delete Match */}
              <button
                type="button"
                onClick={() => deleteMatch(managingMatch.id)}
                className="w-full py-3 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete Match & Free Play Area
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. COMPLETION / RESULT MODAL */}
      {finishingMatch && (
        <div className="fixed inset-0 bg-indigo-950/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-10 w-full max-w-md shadow-2xl border border-gray-100 dark:border-zinc-800 text-center space-y-8">
            <div>
              <h2 className="text-2xl font-black text-gray-900 dark:text-white">
                {finishingMatch.isWalkover ? "Confirm Walkover" : "Declare Match Winner"}
              </h2>
              <p className="text-xs text-gray-500 font-medium mt-2">
                {finishingMatch.isWalkover
                  ? "Select the team that reported and is awarded the walkover victory."
                  : "Select the winning team. The play area will become FREE and participating players will reset to REGISTERED."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => submitMatchResult("team1")}
                className="p-6 border-2 border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100 rounded-3xl text-blue-900 dark:text-blue-200 font-black text-sm flex flex-col items-center transition-all hover:scale-105"
              >
                <CheckCircle2 className="w-10 h-10 text-blue-600 mb-3" />
                Team 1 Wins
                <span className="text-xs font-semibold text-blue-500 mt-1 truncate max-w-[120px]">
                  {finishingMatch.match.team1_p1?.name}
                </span>
              </button>

              <button
                onClick={() => submitMatchResult("team2")}
                className="p-6 border-2 border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/30 hover:bg-rose-100 rounded-3xl text-rose-900 dark:text-rose-200 font-black text-sm flex flex-col items-center transition-all hover:scale-105"
              >
                <CheckCircle2 className="w-10 h-10 text-rose-600 mb-3" />
                Team 2 Wins
                <span className="text-xs font-semibold text-rose-500 mt-1 truncate max-w-[120px]">
                  {finishingMatch.match.team2_p1?.name}
                </span>
              </button>
            </div>

            <button
              onClick={() => setFinishingMatch(null)}
              className="text-xs font-black text-gray-400 hover:text-gray-800 dark:hover:text-white uppercase tracking-widest"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Eligible Players Datalist for Autocomplete */}
      <datalist id="eligible-players">
        {eligiblePlayers.map((p) => (
          <option key={p.id} value={p.employee_id}>
            {p.name} ({p.sport}) - {p.status}
          </option>
        ))}
      </datalist>
    </div>
  );
}
