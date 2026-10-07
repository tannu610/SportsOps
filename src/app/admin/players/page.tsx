"use client";

import { useState, useEffect, useMemo } from "react";
import { Upload, Download, Search, Plus, CheckCircle, AlertTriangle, X, Filter, RotateCcw } from "lucide-react";
import * as XLSX from "xlsx";
import { createClient } from "@/utils/supabase/client";
import { extractPlayerCode, extractPlayerSource } from "@/utils/playerCode";

type PlayerRecord = {
  id: string; // Employee ID
  dbId?: string; // DB UUID
  playerCode: string;
  gender: string;
  source: string;
  name: string;
  sport: string;
  category: string;
  round: string;
  status: string;
  checkIn: string; // ISO string or "-"
};

type ImportSummary = {
  total: number;
  success: number;
  errors: string[];
  parsedData: any[];
};

export default function PlayersPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [genderFilter, setGenderFilter] = useState("ALL");
  const [sportFilter, setSportFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [eventSportsMap, setEventSportsMap] = useState<Record<string, string[]>>({});
  
  const supabase = createClient();

  const loadData = async () => {
    setIsLoading(true);
    let { data: events } = await supabase.from('events').select('*').limit(1);
    let currentEventId;
    
    if (!events || events.length === 0) {
      const { data: newEvent } = await supabase.from('events').insert([
        { name: 'Annual Sports Day 2026', sport: 'Multi-Sport', event_date: '2026-09-15', venue: 'HQ Sports Complex' }
      ]).select().single();
      if (newEvent) currentEventId = newEvent.id;
    } else {
      currentEventId = events[0].id;
    }
    
    if (currentEventId) {
      setEventId(currentEventId);

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

      const eventConfigSports = events?.[0]?.configuration?.sports;
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
        const mapped = dbPlayers.map(p => {
          const playerCode = extractPlayerCode(p) || "-";
          const gender = p.gender || p.push_subscription?._metadata?.gender || "-";
          const source = extractPlayerSource(p);

          return {
            id: p.employee_id,
            dbId: p.id,
            playerCode,
            gender,
            source,
            name: p.name,
            sport: p.sport,
            category: p.category || 'NA',
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet) as any[];
        
        const errors: string[] = [];
        const validRecords: any[] = [];
        
        data.forEach((row, index) => {
          const empId = String(row['Employee ID'] || row['Employee Id'] || row['employee_id'] || '').trim();
          const name = row['Name'] || row['name'];
          const sport = row['Sport'] || row['sport'];
          const category = row['Category'] || row['category'] || 'NA';
          const contact = row['Contact'] || row['Mobile'] || row['Phone'];
          const gender = row['Gender'] || row['gender'] || null;

          if (!empId) errors.push(`Row ${index + 2}: Missing Employee ID`);
          else if (!name) errors.push(`Row ${index + 2}: Missing Player Name (${empId})`);
          else if (!sport) errors.push(`Row ${index + 2}: Missing Sport for ${name}`);
          else {
            if (validRecords.some(r => r.empId === empId && r.sport === sport && r.category === category)) {
              errors.push(`Row ${index + 2}: Duplicate Employee ID (${empId}) for sport ${sport} - ${category} in file`);
            } else if (players.some(p => p.id === empId && p.sport === sport && p.category === category)) {
              errors.push(`Row ${index + 2}: Employee ID (${empId}) already exists for sport ${sport} - ${category} in the system`);
            } else {
              validRecords.push({ empId, name, sport, category, contact, gender });
            }
          }
        });

        setImportSummary({ total: data.length, success: validRecords.length, errors, parsedData: validRecords });
      } catch (error) {
        alert("Error parsing file. Please ensure it is a valid Excel or CSV file.");
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
    categoryFilter !== "ALL";

  const clearFilters = () => {
    setSourceFilter("ALL");
    setStatusFilter("ALL");
    setGenderFilter("ALL");
    setSportFilter("ALL");
    setCategoryFilter("ALL");
  };

  const filteredPlayers = useMemo(() => {
    return players.filter(p => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.playerCode.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
      const matchesSource = sourceFilter === "ALL" || p.source === sourceFilter;
      const matchesGender =
        genderFilter === "ALL" ||
        (p.gender && p.gender.trim().toLowerCase() === genderFilter.toLowerCase());
      const matchesSport =
        sportFilter === "ALL" ||
        (p.sport && p.sport.trim().toLowerCase() === sportFilter.toLowerCase());

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
        matchesCategory
      );
    });
  }, [players, searchQuery, statusFilter, sourceFilter, genderFilter, sportFilter, categoryFilter]);

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
          <h1 className="text-2xl font-bold tracking-tight">Players & Import</h1>
          <p className="text-sm text-gray-500">Manage registered players, track walk-in registrations, and update attendance.</p>
        </div>
        
        <div className="flex gap-3 w-full sm:w-auto">
          <button 
            onClick={() => { setIsUploading(true); setImportSummary(null); }}
            className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Upload className="w-4 h-4 mr-2" />
            Import File
          </button>
        </div>
      </div>

      {isUploading && (
        <div className="p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl relative shadow-md">
          <button onClick={() => setIsUploading(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          
          {!importSummary ? (
            <>
              <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">Import from MS Teams Forms</h3>
              <p className="text-sm text-blue-700 dark:text-blue-400 mb-4">Upload the Excel or CSV export. Columns: 'Employee ID', 'Name', 'Sport', 'Mobile' (optional), 'Gender' (optional).</p>
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-blue-400 border-dashed rounded-lg cursor-pointer bg-white dark:bg-zinc-900 hover:bg-blue-100/50 transition-colors">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 text-blue-500 mb-3" />
                    <p className="mb-2 text-sm text-gray-500"><span className="font-semibold">Click to upload</span></p>
                  </div>
                  <input type="file" className="hidden" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={handleFileUpload} />
                </label>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center"><CheckCircle className="w-5 h-5 text-green-500 mr-2" />Import Summary</h3>
              <div className="flex gap-4">
                <button onClick={() => setImportSummary(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={confirmImport} disabled={importSummary.success === 0} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
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
              type="text" placeholder="Search by name, EMP ID, or Player Code..." 
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-950 w-72"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{player.name}</td>
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
