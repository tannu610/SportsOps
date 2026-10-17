"use client";

import { useState, useEffect, useMemo } from "react";
import { Upload, Download, Search, Plus, CheckCircle, AlertTriangle, X, Filter, RotateCcw, Shield, Users, Layers } from "lucide-react";
import * as XLSX from "xlsx";
import { createClient } from "@/utils/supabase/client";
import { extractPlayerCode, extractPlayerSource, extractPlayerTeam } from "@/utils/playerCode";
import { getImportStrategy, detectConfiguredSport } from "@/utils/importStrategies";

type PlayerRecord = {
  id: string; // Employee ID
  dbId?: string; // DB UUID
  playerCode: string;
  gender: string;
  source: string;
  name: string;
  sport: string;
  category: string;
  teamName?: string | null;
  captainName?: string | null;
  isCaptain?: boolean;
  round: string;
  status: string;
  checkIn: string; // ISO string or "-"
};

type ImportSummaryState = {
  sport: string;
  isTeamBased: boolean;
  total: number;
  success: number;
  newPlayers: number;
  existingPlayers: number;
  teamsDetected: string[];
  teamPlayerCounts: Record<string, number>;
  teamCaptains?: Record<string, string>;
  teamsCreatedOrUpdated?: number;
  errors: Array<{ rowNumber: number; reason: string }>;
  skipped: Array<{ rowNumber: number; reason: string }>;
  parsedData: any[];
};

export default function PlayersPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [importSummary, setImportSummary] = useState<ImportSummaryState | null>(null);
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState("Sports Day 2026");
  const [configuredEventSport, setConfiguredEventSport] = useState("Badminton");
  const [activeImportSport, setActiveImportSport] = useState("Badminton");
  const [eventConfigRaw, setEventConfigRaw] = useState<any>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [genderFilter, setGenderFilter] = useState("ALL");
  const [sportFilter, setSportFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [eventSportsMap, setEventSportsMap] = useState<Record<string, string[]>>({});
  
  const supabase = createClient();

  const loadData = async () => {
    setIsLoading(true);
    let { data: events } = await supabase.from('events').select('*').limit(1);
    let currentEventId;
    let currentEvent;
    
    if (!events || events.length === 0) {
      const { data: newEvent } = await supabase.from('events').insert([
        { name: 'Annual Sports Day 2026', sport: 'Multi-Sport', event_date: '2026-09-15', venue: 'HQ Sports Complex' }
      ]).select().single();
      if (newEvent) {
        currentEventId = newEvent.id;
        currentEvent = newEvent;
      }
    } else {
      currentEventId = events[0].id;
      currentEvent = events[0];
    }
    
    if (currentEventId && currentEvent) {
      setEventId(currentEventId);
      setEventName(currentEvent.name || "Sports Day 2026");
      setEventConfigRaw(currentEvent.configuration);

      // Detect configured sport from Event Configuration
      const detected = detectConfiguredSport(currentEvent);
      setConfiguredEventSport(detected);
      setActiveImportSport(detected);

      // Fetch dynamic event configuration (sports & categories) for the active event
      const sportsMap: Record<string, string[]> = {};

      try {
        const { data: relSports } = await supabase
          .from('event_sports')
          .select('sport, event_categories(category)')
          .eq('event_id', currentEventId);

        if (relSports && relSports.length > 0) {
          relSports.forEach((rs: any) => {
            const sName = rs.sport;
            const cats = Array.isArray(rs.event_categories)
              ? rs.event_categories.map((c: any) => c.category)
              : rs.event_categories
              ? [rs.event_categories.category]
              : [];
            sportsMap[sName] = cats;
          });
        }
      } catch (err) {
        console.error("Relational sports query error:", err);
      }

      const eventConfigSports = currentEvent?.configuration?.sports;
      if (eventConfigSports && typeof eventConfigSports === 'object') {
        Object.entries(eventConfigSports).forEach(([sName, cfg]: [string, any]) => {
          if (cfg?.enabled !== false && cfg?.categories && Array.isArray(cfg.categories)) {
            if (!sportsMap[sName] || sportsMap[sName].length === 0) {
              sportsMap[sName] = cfg.categories;
            }
          }
        });
      }

      const { data: dbPlayers } = await supabase
        .from('players')
        .select('*')
        .eq('event_id', currentEventId)
        .order('created_at', { ascending: false });

      if (dbPlayers) {
        // Fallback: if no sports configured yet, populate from registered players
        if (Object.keys(sportsMap).length === 0) {
          dbPlayers.forEach((p: any) => {
            const s = p.sport ? p.sport.trim() : '';
            if (!s) return;
            if (!sportsMap[s]) sportsMap[s] = [];
            const cats = p.category ? p.category.split(',').map((c: string) => c.trim()).filter(Boolean) : [];
            cats.forEach((c: string) => {
              if (!sportsMap[s].includes(c)) sportsMap[s].push(c);
            });
          });
        }

        setEventSportsMap(sportsMap);
        const mapped: PlayerRecord[] = dbPlayers.map(p => {
          const playerCode = extractPlayerCode(p) || "-";
          const gender = p.gender || p.push_subscription?._metadata?.gender || "-";
          const source = extractPlayerSource(p);
          const teamName = extractPlayerTeam(p);
          const meta = p.push_subscription?._metadata;
          const captainName = meta?.captain_name || null;
          const isCaptain = meta?.is_captain === true;

          return {
            id: p.employee_id,
            dbId: p.id,
            playerCode,
            gender,
            source,
            name: p.name,
            sport: p.sport,
            category: p.category || 'NA',
            teamName,
            captainName,
            isCaptain,
            round: p.current_round ? `Round ${p.current_round}` : 'Round 1',
            status: p.status,
            checkIn: p.check_in_time || "-"
          };
        });
        setPlayers(mapped);

        // Auto-backfill check: if any existing players are missing player codes, backfill them
        if (mapped.some(p => !p.playerCode || p.playerCode === "-")) {
          fetch('/api/admin/players/backfill', { method: 'POST' })
            .then(res => res.json())
            .then(res => {
              if (res.updatedCount > 0) {
                loadData();
              }
            })
            .catch(err => console.error("Auto backfill error:", err));
        }
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel('players_import_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeStrategy = useMemo(() => {
    return getImportStrategy(activeImportSport);
  }, [activeImportSport]);

  const handleDownloadTemplate = () => {
    try {
      const sampleData = activeStrategy.getTemplateData();
      const ws = XLSX.utils.json_to_sheet(sampleData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Roster");
      XLSX.writeFile(wb, activeStrategy.templateFilename);
    } catch (err: any) {
      alert("Error generating template: " + err.message);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const dataBuffer = evt.target?.result;
        const workbook = XLSX.read(dataBuffer, { type: "array" });
        const sheetName = workbook.SheetNames.find(n => /player|roster|import/i.test(n)) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet) as any[];

        // Use Sport Import Strategy for validation and preview
        const validation = activeStrategy.parseAndValidate(data, players, eventConfigRaw);

        setImportSummary({
          sport: activeStrategy.sportName,
          isTeamBased: activeStrategy.isTeamBased,
          total: validation.totalRows,
          success: validation.validRecords.length,
          newPlayers: validation.newPlayersCount,
          existingPlayers: validation.existingPlayersCount,
          teamsDetected: validation.teamsDetected,
          teamPlayerCounts: validation.teamPlayerCounts,
          teamCaptains: validation.teamCaptains,
          teamsCreatedOrUpdated: validation.teamsCreatedOrUpdated ?? validation.teamsDetected.length,
          errors: validation.errors,
          skipped: validation.skipped,
          parsedData: validation.validRecords
        });
      } catch (error: any) {
        alert("Error parsing file. Please ensure it is a valid Excel (.xlsx) or CSV file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmImport = async () => {
    if (!importSummary || !eventId) return;
    
    try {
      const res = await fetch('/api/admin/players/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          sport: activeStrategy.sportName,
          records: importSummary.parsedData
        })
      });

      const result = await res.json();
      if (!res.ok || result.error) {
        alert(`Import Error: ${result.error || 'Failed to import players'}`);
        return;
      }

      await loadData();
      setImportSummary(null);
      setIsUploading(false);
    } catch (err: any) {
      alert(`Import Request Error: ${err.message}`);
    }
  };

  const availableSports = useMemo(() => {
    return Object.keys(eventSportsMap);
  }, [eventSportsMap]);

  const availableTeams = useMemo(() => {
    const set = new Set<string>();
    players.forEach(p => {
      if (p.teamName) set.add(p.teamName);
    });
    return Array.from(set).sort();
  }, [players]);

  const hasTeamsInSystem = availableTeams.length > 0 || configuredEventSport.toLowerCase().includes('cricket');

  const availableCategories = useMemo(() => {
    if (sportFilter !== "ALL") {
      return eventSportsMap[sportFilter] || [];
    }
    const allCats = new Set<string>();
    Object.values(eventSportsMap).forEach((cats) => {
      cats.forEach((c) => allCats.add(c));
    });
    return Array.from(allCats);
  }, [sportFilter, eventSportsMap]);

  const handleSportChange = (newSport: string) => {
    setSportFilter(newSport);
    if (newSport === "ALL") return;

    const validCategoriesForSport = eventSportsMap[newSport] || [];
    if (
      categoryFilter !== "ALL" &&
      !validCategoriesForSport.some(
        (c) => c.toLowerCase() === categoryFilter.toLowerCase()
      )
    ) {
      setCategoryFilter("ALL");
    }
  };

  const hasActiveFilters =
    sourceFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    genderFilter !== "ALL" ||
    sportFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    teamFilter !== "ALL";

  const clearFilters = () => {
    setSourceFilter("ALL");
    setStatusFilter("ALL");
    setGenderFilter("ALL");
    setSportFilter("ALL");
    setCategoryFilter("ALL");
    setTeamFilter("ALL");
  };

  const filteredPlayers = useMemo(() => {
    return players.filter(p => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.playerCode.toLowerCase().includes(q) ||
        (p.teamName && p.teamName.toLowerCase().includes(q));

      const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
      const matchesSource = sourceFilter === "ALL" || p.source === sourceFilter;
      const matchesGender =
        genderFilter === "ALL" ||
        (p.gender && p.gender.trim().toLowerCase() === genderFilter.toLowerCase());
      const matchesSport =
        sportFilter === "ALL" ||
        (p.sport && p.sport.trim().toLowerCase() === sportFilter.toLowerCase());
      const matchesTeam =
        teamFilter === "ALL" ||
        (p.teamName && p.teamName.toLowerCase() === teamFilter.toLowerCase());

      let matchesCategory = true;
      if (categoryFilter !== "ALL") {
        const playerCategories = p.category
          ? p.category.split(',').map((c: string) => c.trim().toLowerCase())
          : [];
        const filterCatLower = categoryFilter.trim().toLowerCase();
        matchesCategory = playerCategories.includes(filterCatLower);
      }

      return (
        matchesSearch &&
        matchesStatus &&
        matchesSource &&
        matchesGender &&
        matchesSport &&
        matchesCategory &&
        matchesTeam
      );
    });
  }, [players, searchQuery, statusFilter, sourceFilter, genderFilter, sportFilter, categoryFilter, teamFilter]);

  const uniqueStatuses = Array.from(new Set(players.map(p => p.status)));

  const formatTime = (isoString: string) => {
    if (isoString === "-") return "-";
    try {
      return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-xs font-black uppercase tracking-wider mb-1">
            <Shield className="w-3.5 h-3.5" />
            Event: {eventName} • Configured Sport: {configuredEventSport}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Players & Import</h1>
          <p className="text-sm text-gray-500">
            {configuredEventSport.toLowerCase() === 'cricket'
              ? 'Manage cricket teams, player rosters, and match-day attendance.'
              : 'Manage registered players, track walk-in registrations, and update attendance.'}
          </p>
        </div>
        
        <div className="flex gap-3 w-full sm:w-auto">
          <button 
            onClick={() => { setIsUploading(true); setImportSummary(null); }}
            className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4 mr-2" />
            {activeStrategy.sportName === 'Cricket' ? 'Import Cricket Roster' : 'Import Players'}
          </button>
        </div>
      </div>

      {isUploading && (
        <div className="p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl relative shadow-md animate-in fade-in duration-150">
          <button onClick={() => setIsUploading(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
          
          {!importSummary ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                      Current Event: {configuredEventSport}
                    </span>
                  </div>
                  <h3 className="font-bold text-lg text-blue-950 dark:text-blue-100 mt-1">
                    {activeStrategy.sportName === 'Cricket' ? 'Upload Cricket Roster' : 'Upload Badminton Player List'}
                  </h3>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5 font-medium">
                    Expected columns: <span className="font-mono font-bold text-blue-900 dark:text-blue-200">{activeStrategy.expectedColumnsDescription}</span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-zinc-800 hover:bg-blue-100/50 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 rounded-xl text-xs font-bold transition-colors shadow-xs"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  Download Template
                </button>
              </div>

              {/* Upload Dropzone */}
              <div className="flex items-center justify-center w-full pt-1">
                <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-blue-400 border-dashed rounded-xl cursor-pointer bg-white dark:bg-zinc-900 hover:bg-blue-100/30 transition-colors">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center">
                    <Upload className="w-8 h-8 text-blue-500 mb-2" />
                    <p className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Click to upload {activeStrategy.sportName} file
                    </p>
                    <p className="text-xs text-gray-400">
                      Excel (.xlsx, .xls) or CSV format
                    </p>
                  </div>
                  <input type="file" className="hidden" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileUpload} />
                </label>
              </div>
            </div>
          ) : (
            /* Clear Import Summary Preview Modal before committing */
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-blue-200 dark:border-blue-800">
                <h3 className="font-black text-lg text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                  Import Summary: {importSummary.sport}
                </h3>
                <span className="text-xs font-bold text-gray-500">
                  Total rows parsed: {importSummary.total}
                </span>
              </div>

              {/* Cricket Teams Detected Section */}
              {importSummary.isTeamBased && (
                <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-blue-200 dark:border-blue-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider text-blue-800 dark:text-blue-300">
                    <span className="flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-blue-600" />
                      Teams Detected ({importSummary.teamsDetected.length}):
                    </span>
                  </div>
                  {importSummary.teamsDetected.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {importSummary.teamsDetected.map((teamName) => (
                        <div
                          key={teamName}
                          className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-black text-blue-900 dark:text-blue-200 flex flex-wrap items-center gap-1.5"
                        >
                          <span>{teamName}</span>
                          <span className="bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100 px-1.5 py-0.2 rounded text-[10px]">
                            {importSummary.teamPlayerCounts[teamName] || 0} players
                          </span>
                          {importSummary.teamCaptains?.[teamName] && (
                            <span className="bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/60 px-1.5 py-0.2 rounded text-[10px] font-bold">
                              Captain: {importSummary.teamCaptains[teamName]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-rose-600 font-bold">No valid teams detected in file.</p>
                  )}
                </div>
              )}

              {/* Statistics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                {importSummary.isTeamBased && (
                  <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Teams Detected</span>
                    <span className="text-xl font-black text-gray-900 dark:text-white mt-0.5 block">{importSummary.teamsDetected.length}</span>
                  </div>
                )}
                <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Total Players</span>
                  <span className="text-xl font-black text-gray-900 dark:text-white mt-0.5 block">{importSummary.success}</span>
                </div>
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 block">New Players</span>
                  <span className="text-xl font-black text-emerald-700 dark:text-emerald-300 mt-0.5 block">{importSummary.newPlayers}</span>
                  <span className="text-[10px] text-emerald-600 font-medium block">Will receive Player Codes</span>
                </div>
                <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 block">Existing Players</span>
                  <span className="text-xl font-black text-indigo-700 dark:text-indigo-300 mt-0.5 block">{importSummary.existingPlayers}</span>
                  <span className="text-[10px] text-indigo-600 font-medium block">Retain Player Codes</span>
                </div>
                {importSummary.isTeamBased && (
                  <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300 block">Teams Created / Updated</span>
                    <span className="text-xl font-black text-purple-700 dark:text-purple-300 mt-0.5 block">{importSummary.teamsCreatedOrUpdated ?? importSummary.teamsDetected.length}</span>
                    <span className="text-[10px] text-purple-600 font-medium block">Matched by Event + Name</span>
                  </div>
                )}
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 block">Skipped / Invalid</span>
                  <span className="text-xl font-black text-amber-700 dark:text-amber-300 mt-0.5 block">
                    {importSummary.errors.length + importSummary.skipped.length}
                  </span>
                </div>
              </div>

              {/* Error messages if any */}
              {importSummary.errors.length > 0 && (
                <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl space-y-2 max-h-40 overflow-y-auto text-xs">
                  <div className="font-black text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    Validation Errors ({importSummary.errors.length}):
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-rose-700 dark:text-rose-400 font-medium">
                    {importSummary.errors.map((err, i) => (
                      <li key={i}>
                        <span className="font-bold">Row {err.rowNumber}:</span> {err.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Skipped messages if any */}
              {importSummary.skipped.length > 0 && (
                <div className="p-3 bg-gray-100 dark:bg-zinc-800/80 rounded-xl space-y-1 max-h-28 overflow-y-auto text-xs">
                  <div className="font-bold text-gray-600 dark:text-gray-300">
                    Skipped Rows ({importSummary.skipped.length}):
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-gray-500 font-medium text-[11px]">
                    {importSummary.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="font-semibold">Row {s.rowNumber}:</span> {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setImportSummary(null)}
                  className="px-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-xl text-xs font-black hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={importSummary.success === 0}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-md shadow-blue-600/25 transition disabled:opacity-50 cursor-pointer"
                >
                  Import {importSummary.success} Players
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Players Table */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-gray-200 dark:border-zinc-800 flex flex-wrap gap-4 justify-between items-center bg-gray-50/50 dark:bg-zinc-900/50">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" placeholder="Search by name, EMP ID, Player Code, or Team..." 
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-950 w-72"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Team Filter (shown when teams exist or sport is Cricket) */}
            {hasTeamsInSystem && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-medium">Team:</span>
                <select 
                  value={teamFilter} 
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  <option value="ALL">All Teams</option>
                  {availableTeams.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {/* Source Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Source:</span>
              <select 
                value={sourceFilter} 
                onChange={(e) => setSourceFilter(e.target.value)}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Sources</option>
                <option value="IMPORT">IMPORT</option>
                <option value="WALK-IN">WALK-IN</option>
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select 
                value={statusFilter} 
                onChange={(e) => setStatusFilter(e.target.value)}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Statuses</option>
                {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Gender Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Gender:</span>
              <select 
                value={genderFilter} 
                onChange={(e) => setGenderFilter(e.target.value)}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>

            {/* Sport Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Sport:</span>
              <select 
                value={sportFilter} 
                onChange={(e) => handleSportChange(e.target.value)}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All</option>
                {availableSports.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Category:</span>
              <select 
                value={categoryFilter} 
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="py-1.5 px-3 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All</option>
                {availableCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 rounded-lg border border-rose-200 dark:border-rose-900 transition-colors"
                title="Reset all filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Clear Filters
              </button>
            )}

            <div className="text-sm text-gray-500 font-medium border-l pl-3 border-gray-300 dark:border-zinc-700 whitespace-nowrap">
              Total: {filteredPlayers.length}
              {filteredPlayers.length !== players.length && (
                <span className="text-xs text-gray-400 ml-1">of {players.length}</span>
              )}
            </div>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          {isLoading ? (
             <div className="p-8 text-center text-gray-500">Loading players...</div>
          ) : filteredPlayers.length === 0 ? (
             <div className="p-12 text-center space-y-3">
               <p className="text-gray-500 dark:text-gray-400 font-medium text-sm">No players match the selected filters.</p>
               {hasActiveFilters && (
                 <button
                   onClick={clearFilters}
                   className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-lg transition-colors"
                 >
                   <RotateCcw className="w-3.5 h-3.5" />
                   Clear Filters
                 </button>
               )}
             </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-zinc-950 text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3 font-medium">EMP ID</th>
                  <th className="px-4 py-3 font-medium">Player Code</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  {hasTeamsInSystem && <th className="px-4 py-3 font-medium">Team & Captain</th>}
                  <th className="px-4 py-3 font-medium">Gender</th>
                  <th className="px-4 py-3 font-medium">Sport / Category</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Check-In Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-zinc-800">
                {filteredPlayers.map((player) => (
                  <tr key={player.dbId || player.id} className="hover:bg-gray-50 dark:hover:bg-zinc-900/50">
                    <td className="px-4 py-3 font-medium font-mono text-xs">{player.id}</td>
                    <td className="px-4 py-3 font-bold font-mono text-xs text-blue-600 dark:text-blue-400">{player.playerCode}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <div className="flex items-center gap-1.5">
                        <span>{player.name}</span>
                        {player.isCaptain && (
                          <span className="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded bg-amber-500 text-white shadow-xs" title="Team Captain">
                            Captain
                          </span>
                        )}
                      </div>
                    </td>
                    {hasTeamsInSystem && (
                      <td className="px-4 py-3">
                        {player.teamName ? (
                          <div className="flex flex-col gap-0.5 items-start">
                            <span className="px-2.5 py-0.5 rounded-lg text-xs font-black bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 inline-flex items-center gap-1.5">
                              <span>{player.teamName}</span>
                              {player.isCaptain && (
                                <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 px-1 py-0.2 rounded text-[9px] font-bold">
                                  C
                                </span>
                              )}
                            </span>
                            {!player.isCaptain && player.captainName && (
                              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium pl-0.5">
                                Captain: {player.captainName}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">{player.gender}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-semibold text-gray-800 dark:text-gray-200">{player.sport}</span>
                      <span className="text-gray-500 dark:text-gray-400 block">{player.category}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase ${
                        player.source === 'WALK-IN'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300'
                      }`}>
                        {player.source}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select 
                        value={player.status}
                        onChange={async (e) => {
                          const newStatus = e.target.value;
                          const { error } = await supabase.from('players').update({ status: newStatus }).eq('id', player.dbId);
                          if (!error) {
                            setPlayers(players.map(p => p.dbId === player.dbId ? { ...p, status: newStatus } : p));
                          } else {
                            alert("Override failed: " + error.message);
                          }
                        }}
                        className={`px-2 py-1 rounded-full text-xs font-bold border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 appearance-none ${
                          player.status === 'PRESENT' || player.status === 'AVAILABLE' ? 'bg-green-100 text-green-800' :
                          player.status.includes('QUALIFIED') ? 'bg-indigo-100 text-indigo-800' :
                          player.status === 'DISQUALIFIED' || player.status === 'NO_SHOW' ? 'bg-red-100 text-red-800' :
                          player.status === 'PLAYING' ? 'bg-blue-100 text-blue-800' :
                          player.status === 'REGISTERED' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {!['REGISTERED', 'PRESENT', 'CALLED', 'AVAILABLE', 'UNAVAILABLE', 'PLAYING', 'DISQUALIFIED', 'NO_SHOW'].includes(player.status) && (
                           <option value={player.status}>{player.status}</option>
                        )}
                        <option value="REGISTERED">REGISTERED</option>
                        <option value="PRESENT">PRESENT</option>
                        <option value="CALLED">CALLED</option>
                        <option value="AVAILABLE">AVAILABLE</option>
                        <option value="UNAVAILABLE">UNAVAILABLE</option>
                        <option value="PLAYING">PLAYING</option>
                        <option value="DISQUALIFIED">DISQUALIFIED</option>
                        <option value="NO_SHOW">NO_SHOW</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{formatTime(player.checkIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
