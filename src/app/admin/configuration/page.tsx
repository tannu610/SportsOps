"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  Save,
  CheckCircle2,
  AlertCircle,
  Trophy,
  Plus,
  Trash2,
  Layers,
  MapPin,
  Calendar,
  Building,
  Check,
  RefreshCw,
  FolderPlus
} from "lucide-react";
import {
  SportConfig,
  SPORT_FACILITY_DEFAULTS,
  DEFAULT_SPORTS_CONFIG,
  validateEventConfigPayload
} from "@/utils/eventConfig";

interface EventListItem {
  id: string;
  name: string;
  event_date: string;
  venue: string;
}

export default function EventConfigurationPage() {
  const [eventsList, setEventsList] = useState<EventListItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [venue, setVenue] = useState("");
  
  const [sportsConfig, setSportsConfig] = useState<Record<string, SportConfig>>(DEFAULT_SPORTS_CONFIG);
  const [newCategoryInputs, setNewCategoryInputs] = useState<Record<string, string>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dataSource, setDataSource] = useState<string>('database');

  async function loadConfig(targetId?: string | null) {
    setIsLoading(true);
    setMessage(null);
    try {
      const url = targetId ? `/api/admin/event/config?eventId=${targetId}` : '/api/admin/event/config';
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.eventsList) {
        setEventsList(data.eventsList);
      }

      if (data.event) {
        setSelectedEventId(data.event.id);
        setName(data.event.name || "");
        setEventDate(data.event.event_date || "");
        setVenue(data.event.venue || "");
        setIsCreatingNew(false);
      } else {
        setIsCreatingNew(true);
      }
      
      if (data.configuration?.sports) {
        setSportsConfig({
          ...DEFAULT_SPORTS_CONFIG,
          ...data.configuration.sports
        });
      }

      if (data.source) {
        setDataSource(data.source);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to load event configuration: ' + err.message });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSelectEvent = (evId: string) => {
    if (evId === 'NEW') {
      setIsCreatingNew(true);
      setSelectedEventId(null);
      setName("");
      setEventDate("");
      setVenue("");
      setSportsConfig(DEFAULT_SPORTS_CONFIG);
      setMessage(null);
    } else {
      setIsCreatingNew(false);
      setSelectedEventId(evId);
      loadConfig(evId);
    }
  };

  const handleToggleSport = (sportName: string) => {
    setSportsConfig((prev) => {
      const current = prev[sportName] || {
        enabled: false,
        facilityType: SPORT_FACILITY_DEFAULTS[sportName]?.facilityType || "Courts",
        facilityUnit: SPORT_FACILITY_DEFAULTS[sportName]?.facilityUnit || "Court",
        facilityCount: SPORT_FACILITY_DEFAULTS[sportName]?.defaultCount || 4,
        categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"]
      };

      return {
        ...prev,
        [sportName]: {
          ...current,
          enabled: !current.enabled
        }
      };
    });
  };

  const handleFacilityCountChange = (sportName: string, count: number) => {
    setSportsConfig((prev) => ({
      ...prev,
      [sportName]: {
        ...prev[sportName],
        facilityCount: Math.max(1, count)
      }
    }));
  };

  const handleAddCategory = (sportName: string) => {
    const inputVal = (newCategoryInputs[sportName] || '').trim();
    if (!inputVal) return;

    setSportsConfig((prev) => {
      const currentCategories = prev[sportName]?.categories || [];
      if (currentCategories.includes(inputVal)) return prev;

      return {
        ...prev,
        [sportName]: {
          ...prev[sportName],
          categories: [...currentCategories, inputVal]
        }
      };
    });

    setNewCategoryInputs((prev) => ({ ...prev, [sportName]: '' }));
  };

  const handleRemoveCategory = (sportName: string, category: string) => {
    setSportsConfig((prev) => ({
      ...prev,
      [sportName]: {
        ...prev[sportName],
        categories: (prev[sportName]?.categories || []).filter((c) => c !== category)
      }
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validation
    const validation = validateEventConfigPayload({
      name,
      eventDate,
      venue,
      configuration: { sports: sportsConfig }
    });

    if (!validation.valid) {
      setMessage({ type: 'error', text: validation.error || 'Validation failed' });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/admin/event/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: isCreatingNew ? null : selectedEventId,
          name: name.trim(),
          eventDate,
          venue: venue.trim(),
          configuration: { sports: sportsConfig }
        })
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to save configuration');
      }

      setMessage({
        type: 'success',
        text: `Event configuration ${isCreatingNew ? 'created' : 'updated'} successfully in Supabase! Court Management now uses this source of truth.`
      });

      if (result.event?.id) {
        setSelectedEventId(result.event.id);
        setIsCreatingNew(false);
        // Refresh event list to include newly created/edited event
        loadConfig(result.event.id);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const sportList = Object.keys(SPORT_FACILITY_DEFAULTS);

  return (
    <div className="max-w-4xl space-y-8 pb-20">
      {/* Header & Event Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-white flex items-center gap-3">
            <Settings className="w-8 h-8 text-blue-600" />
            Event Configuration
          </h1>
          <p className="text-gray-500 font-medium text-sm mt-1">
            Configure tournament sports, facilities, and competition categories. Stored in Supabase as the single source of truth.
          </p>
        </div>

        {/* Mode / Event Selector */}
        <div className="flex items-center gap-2">
          {eventsList.length > 0 && (
            <select
              value={isCreatingNew ? 'NEW' : (selectedEventId || '')}
              onChange={(e) => handleSelectEvent(e.target.value)}
              className="px-3 py-2 text-xs font-bold rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {eventsList.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.event_date || 'No Date'})
                </option>
              ))}
              <option value="NEW">+ Create New Event</option>
            </select>
          )}

          {!isCreatingNew && (
            <button
              type="button"
              onClick={() => handleSelectEvent('NEW')}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-xl text-xs font-black transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" /> New Event
            </button>
          )}
        </div>
      </div>

      {message && (
        <div
          id="config-alert-message"
          className={`p-4 rounded-2xl flex items-center gap-3 animate-in fade-in duration-200 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-sm'
              : 'bg-rose-50 text-rose-800 border border-rose-200 shadow-sm'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
          )}
          <span className="text-sm font-bold">{message.text}</span>
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-gray-400 font-medium text-sm flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
          <span>Loading Event Configuration from Supabase...</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-8">
          {/* Status Badge */}
          <div className="flex items-center justify-between px-2 text-xs font-semibold text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Mode: {isCreatingNew ? 'Creating New Event' : `Editing Event (${selectedEventId?.slice(0, 8)}...)`}
            </span>
            <span>Source: {dataSource}</span>
          </div>

          {/* 1. EVENT DETAILS */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm space-y-5">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Building className="w-5 h-5 text-blue-600" />
              1. Event Details
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-1.5">
                  Event Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Annual Sports Day 2026"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50/50 dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" /> Event Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50/50 dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> Venue <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    required
                    placeholder="e.g. Main Sports Complex"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50/50 dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 2. SPORTS SELECTION */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Trophy className="w-5 h-5 text-blue-600" />
                2. Select Sports <span className="text-rose-500 text-sm">*</span>
              </h2>
              <span className="text-xs font-medium text-gray-400">
                Select one or multiple sports
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {sportList.map((s) => {
                const isSelected = !!sportsConfig[s]?.enabled;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleToggleSport(s)}
                    className={`p-4 rounded-2xl border-2 text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 shadow-sm'
                        : 'border-gray-200 dark:border-zinc-800 hover:border-gray-300 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <span className="font-extrabold text-sm">{s}</span>
                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center border ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. FACILITY & CATEGORY CONFIGURATION PER SPORT */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" />
                3. Facility & Category Configuration
              </h2>
              <span className="text-xs font-medium text-gray-400">
                Configured independently per sport
              </span>
            </div>

            {sportList.filter((s) => sportsConfig[s]?.enabled).length === 0 ? (
              <div className="p-12 text-center border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl text-gray-400 font-medium text-sm">
                No sports selected above. Please select at least one sport to configure facilities and categories.
              </div>
            ) : (
              sportList
                .filter((s) => sportsConfig[s]?.enabled)
                .map((sportName) => {
                  const cfg = sportsConfig[sportName];
                  const facilityInfo = SPORT_FACILITY_DEFAULTS[sportName] || {
                    facilityType: "Courts",
                    facilityUnit: "Court",
                    defaultCount: 4
                  };

                  const previewAreas = Array.from(
                    { length: Math.min(cfg.facilityCount || 1, 8) },
                    (_, i) => `${cfg.facilityUnit || facilityInfo.facilityUnit} ${i + 1}`
                  );

                  return (
                    <div
                      key={sportName}
                      className="bg-white dark:bg-zinc-900 border-2 border-blue-100 dark:border-blue-900/30 rounded-3xl p-6 shadow-sm space-y-6"
                    >
                      <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
                        <div className="flex items-center gap-3">
                          <span className="w-3 h-3 rounded-full bg-blue-600" />
                          <h3 className="text-base font-black text-gray-900 dark:text-white uppercase tracking-wide">
                            {sportName} Configuration
                          </h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleSport(sportName)}
                          className="text-xs font-bold text-rose-500 hover:text-rose-600"
                        >
                          Remove Sport
                        </button>
                      </div>

                      {/* Facility Configuration */}
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <label className="text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-300">
                              Facility Type: {cfg.facilityType || facilityInfo.facilityType}
                            </label>
                            <p className="text-xs text-gray-400">
                              Total available {cfg.facilityType?.toLowerCase() || facilityInfo.facilityType.toLowerCase()} for {sportName}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-500">
                              {cfg.facilityType || facilityInfo.facilityType}:
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={cfg.facilityCount || 1}
                              onChange={(e) =>
                                handleFacilityCountChange(sportName, parseInt(e.target.value) || 1)
                              }
                              className="w-20 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 text-center font-black text-blue-600 bg-gray-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>

                        {/* Preview of Court / Facility Names */}
                        <div className="p-3 bg-gray-50 dark:bg-zinc-800/50 rounded-2xl text-xs space-y-1">
                          <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                            Generated Playing Areas ({cfg.facilityCount}):
                          </span>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {previewAreas.map((areaName) => (
                              <span
                                key={areaName}
                                className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 font-bold text-gray-700 dark:text-zinc-300 text-xs"
                              >
                                {areaName}
                              </span>
                            ))}
                            {(cfg.facilityCount || 1) > 8 && (
                              <span className="px-2 py-1 text-xs text-gray-400 font-bold">
                                + {(cfg.facilityCount || 1) - 8} more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Categories Configuration */}
                      <div className="space-y-3 pt-2">
                        <label className="text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-300 block">
                          Competition Categories for {sportName} <span className="text-rose-500">*</span>
                        </label>

                        {/* Category Checkboxes */}
                        <div className="flex flex-wrap gap-2">
                          {(cfg.categories || []).map((cat) => (
                            <div
                              key={cat}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50/70 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold text-blue-900 dark:text-blue-200 shadow-sm"
                            >
                              <span>{cat}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveCategory(sportName, cat)}
                                className="text-blue-400 hover:text-rose-500 transition-colors ml-1"
                                title="Remove category"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Add Custom Category */}
                        <div className="flex gap-2 pt-1">
                          <input
                            type="text"
                            placeholder={`Add category for ${sportName} (e.g. Mixed Doubles, U-19)`}
                            value={newCategoryInputs[sportName] || ''}
                            onChange={(e) =>
                              setNewCategoryInputs((prev) => ({
                                ...prev,
                                [sportName]: e.target.value
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddCategory(sportName);
                              }
                            }}
                            className="flex-1 px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50/50 dark:bg-zinc-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddCategory(sportName)}
                            className="px-4 py-2 bg-gray-100 dark:bg-zinc-800 hover:bg-blue-50 hover:text-blue-600 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Category
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>

          {/* SAVE BUTTON */}
          <div className="pt-4 sticky bottom-6 z-20">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-base rounded-2xl transition-all shadow-xl shadow-blue-500/20"
            >
              <Save className="w-5 h-5" />
              {isSaving ? "Saving to Supabase..." : (isCreatingNew ? "Create & Save Event" : "Save Event Configuration")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
