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
  Check
} from "lucide-react";
import { SportConfig, EventConfiguration, DEFAULT_SPORTS_CONFIG } from "@/utils/eventConfig";

const SPORT_FACILITY_DEFAULTS: Record<string, { facilityType: string; facilityUnit: string; defaultCount: number }> = {
  "Badminton": { facilityType: "Courts", facilityUnit: "Court", defaultCount: 6 },
  "Table Tennis": { facilityType: "Tables", facilityUnit: "Table", defaultCount: 4 },
  "Cricket": { facilityType: "Grounds", facilityUnit: "Ground", defaultCount: 2 },
  "Football": { facilityType: "Grounds", facilityUnit: "Ground", defaultCount: 2 },
  "Volleyball": { facilityType: "Courts", facilityUnit: "Court", defaultCount: 2 },
  "Other": { facilityType: "Playing Areas", facilityUnit: "Area", defaultCount: 3 }
};

export default function EventConfigurationPage() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [venue, setVenue] = useState("");
  
  const [sportsConfig, setSportsConfig] = useState<Record<string, SportConfig>>(DEFAULT_SPORTS_CONFIG);
  const [newCategoryInputs, setNewCategoryInputs] = useState<Record<string, string>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function loadConfig() {
      setIsLoading(true);
      try {
        const res = await fetch('/api/admin/event/config');
        const data = await res.json();
        
        if (data.event) {
          setEventId(data.event.id);
          setName(data.event.name || "");
          setEventDate(data.event.event_date || "");
          setVenue(data.event.venue || "");
        }
        
        if (data.configuration?.sports) {
          setSportsConfig({
            ...DEFAULT_SPORTS_CONFIG,
            ...data.configuration.sports
          });
        }
      } catch (err: any) {
        setMessage({ type: 'error', text: 'Failed to load configuration: ' + err.message });
      } finally {
        setIsLoading(false);
      }
    }

    loadConfig();
  }, []);

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

  const handleToggleCategory = (sportName: string, category: string) => {
    setSportsConfig((prev) => {
      const currentCategories = prev[sportName]?.categories || [];
      const exists = currentCategories.includes(category);
      const updatedCategories = exists
        ? currentCategories.filter((c) => c !== category)
        : [...currentCategories, category];

      return {
        ...prev,
        [sportName]: {
          ...prev[sportName],
          categories: updatedCategories
        }
      };
    });
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
    if (!name.trim()) {
      setMessage({ type: 'error', text: 'Please enter an Event Name.' });
      return;
    }

    const enabledSports = Object.entries(sportsConfig).filter(([_, cfg]) => cfg.enabled);
    if (enabledSports.length === 0) {
      setMessage({ type: 'error', text: 'Please select at least one sport for the event.' });
      return;
    }

    for (const [sportName, cfg] of enabledSports) {
      if (!cfg.categories || cfg.categories.length === 0) {
        setMessage({ type: 'error', text: `Please select or add at least one category for ${sportName}.` });
        return;
      }
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/admin/event/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          name,
          eventDate,
          venue,
          configuration: { sports: sportsConfig }
        })
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to save configuration');
      }

      setMessage({
        type: 'success',
        text: 'Event configuration saved successfully! Court Management and Match Creation will now use these settings.'
      });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const sportList = Object.keys(DEFAULT_SPORTS_CONFIG);

  return (
    <div className="max-w-4xl space-y-8 pb-20">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-white flex items-center gap-3">
          <Settings className="w-8 h-8 text-blue-600" />
          Event Configuration
        </h1>
        <p className="text-gray-500 font-medium text-sm mt-1">
          Define tournament sports, playing facilities, and competition categories. Match & Court Management will dynamically reflect these choices.
        </p>
      </div>

      {message && (
        <div
          id="config-alert-message"
          className={`p-4 rounded-2xl flex items-center gap-3 ${
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
        <div className="py-16 text-center text-gray-400 font-medium text-sm">
          Loading Event Configuration...
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-8">
          {/* 1. EVENT DETAILS */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm space-y-5">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Building className="w-5 h-5 text-blue-600" />
              1. Event Details
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-1.5">
                  Event Name
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
                    <Calendar className="w-3.5 h-3.5" /> Event Date
                  </label>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50/50 dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> Venue
                  </label>
                  <input
                    type="text"
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
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
                2. Select Tournament Sports
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

          {/* 3. PER-SPORT FACILITY & CATEGORY CONFIGURATION */}
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
                              Facility: {cfg.facilityType || facilityInfo.facilityType}
                            </label>
                            <p className="text-xs text-gray-400">
                              Number of available {cfg.facilityType?.toLowerCase() || facilityInfo.facilityType.toLowerCase()} for {sportName}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-500">
                              {cfg.facilityType || facilityInfo.facilityType}:
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={30}
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
                          Competition Categories for {sportName}
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
                            placeholder={`e.g. Mixed Doubles, Under-19`}
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
              {isSaving ? "Saving Configuration..." : "Save Configuration"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
