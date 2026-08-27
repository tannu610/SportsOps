"use client";

import { useState, useEffect, useMemo } from "react";
import { Upload, Download, Search, Plus, CheckCircle, AlertTriangle, X, Filter } from "lucide-react";
import * as XLSX from "xlsx";
import { createClient } from "@/utils/supabase/client";

type PlayerRecord = {
  id: string; // Employee ID
  dbId?: string; // DB UUID
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
  
  const supabase = createClient();

  useEffect(() => {
    async function loadData() {
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
        const { data: dbPlayers } = await supabase
          .from('players')
          .select('*')
          .eq('event_id', currentEventId)
          .order('created_at', { ascending: false });
          
        if (dbPlayers) {
          setPlayers(dbPlayers.map(p => ({
            id: p.employee_id,
            dbId: p.id,
            name: p.name,
            sport: p.sport,
            category: p.category || 'NA',
            round: p.current_round ? `Round ${p.current_round}` : 'Round 1',
            status: p.status,
            checkIn: p.check_in_time || "-"
          })));
        }
      }
      setIsLoading(false);
    }
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

          if (!empId) errors.push(`Row ${index + 2}: Missing Employee ID`);
          else if (!name) errors.push(`Row ${index + 2}: Missing Player Name (${empId})`);
          else if (!sport) errors.push(`Row ${index + 2}: Missing Sport for ${name}`);
          else {
            if (validRecords.some(r => r.empId === empId && r.sport === sport && r.category === category)) {
              errors.push(`Row ${index + 2}: Duplicate Employee ID (${empId}) for sport ${sport} - ${category} in file`);
            } else if (players.some(p => p.id === empId && p.sport === sport && p.category === category)) {
              errors.push(`Row ${index + 2}: Employee ID (${empId}) already exists for sport ${sport} - ${category} in the system`);
            } else {
              validRecords.push({ empId, name, sport, category, contact });
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
    
    const insertData = importSummary.parsedData.map(r => ({
      event_id: eventId,
      employee_id: r.empId,
      name: r.name,
      sport: r.sport,
      category: r.category,
      current_round: 1,
      contact_info: r.contact ? String(r.contact) : null,
      status: 'REGISTERED'
    }));

    const { data: insertedData, error } = await supabase.from('players').insert(insertData).select();

    if (error) {
      alert(`Database Error: ${error.message}`);
      return;
    }
    
    if (insertedData) {
      const newPlayers = insertedData.map(p => ({
        id: p.employee_id, dbId: p.id, name: p.name, sport: p.sport, category: p.category || 'NA', round: p.current_round ? `Round ${p.current_round}` : 'Round 1', status: p.status, checkIn: p.check_in_time || "-"
      }));
      setPlayers([...newPlayers, ...players]);
    }
    setImportSummary(null);
    setIsUploading(false);
  };

  const filteredPlayers = useMemo(() => {
    return players.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [players, searchQuery, statusFilter]);

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
          <p className="text-sm text-gray-500">Manage registered players and their attendance status.</p>
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
              <p className="text-sm text-blue-700 dark:text-blue-400 mb-4">Upload the Excel or CSV export. Columns: 'Employee ID', 'Name', 'Sport', 'Mobile' (optional).</p>
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
              type="text" placeholder="Search players..." 
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-950 w-64"
            />
          </div>
          <div className="flex items-center gap-3">
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
            <div className="text-sm text-gray-500 font-medium border-l pl-3 border-gray-300 dark:border-zinc-700">
              Total: {filteredPlayers.length}
            </div>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          {isLoading ? (
             <div className="p-8 text-center text-gray-500">Loading players...</div>
          ) : filteredPlayers.length === 0 ? (
             <div className="p-8 text-center text-gray-500">No players found matching criteria.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-zinc-950 text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3 font-medium">EMP ID</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Sport</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Check-In Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-zinc-800">
                {filteredPlayers.map((player) => (
                  <tr key={player.dbId || player.id} className="hover:bg-gray-50 dark:hover:bg-zinc-900/50">
                    <td className="px-4 py-3 font-medium">{player.id}</td>
                    <td className="px-4 py-3">{player.name}</td>
                    <td className="px-4 py-3">{player.sport}</td>
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
