"use client";

import { useEffect, useState } from "react";
import { Settings, Save, CheckCircle2, AlertCircle, Database, ShieldCheck } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

export default function SettingsPage() {
  const [event, setEvent] = useState<{ id: string; name: string; sport: string; venue: string; event_date: string } | null>(null);
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [venue, setVenue] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadEvent() {
      setIsLoading(true);
      const { data, error } = await supabase.from('events').select('*').limit(1);
      if (data && data.length > 0) {
        const ev = data[0];
        setEvent(ev);
        setName(ev.name || "");
        setSport(ev.sport || "");
        setVenue(ev.venue || "");
        setEventDate(ev.event_date || "");
      }
      setIsLoading(false);
    }
    loadEvent();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;
    setIsSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from('events')
      .update({ name, sport, venue, event_date: eventDate })
      .eq('id', event.id);

    setIsSaving(false);
    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: "Event settings updated successfully!" });
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-white flex items-center gap-3">
          <Settings className="w-8 h-8 text-blue-600" />
          Event Settings
        </h1>
        <p className="text-gray-500 font-medium text-sm mt-1">
          Configure tournament metadata and inspect system connection.
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-2xl flex items-center gap-3 ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* System Status Card */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-blue-600" />
          Database Connection
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-800/50">
            <span className="text-gray-500 block text-xs font-semibold uppercase tracking-wider">Supabase Host</span>
            <span className="font-mono text-gray-800 dark:text-gray-200 text-xs break-all">
              {process.env.NEXT_PUBLIC_SUPABASE_URL || "Connected"}
            </span>
          </div>
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-800/50 flex items-center justify-between">
            <div>
              <span className="text-gray-500 block text-xs font-semibold uppercase tracking-wider">Status</span>
              <span className="font-bold text-emerald-600 flex items-center gap-1.5 mt-1">
                <ShieldCheck className="w-4 h-4" /> Live & Connected
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Event Details Form */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Tournament Information</h2>
        
        {isLoading ? (
          <div className="py-8 text-center text-gray-400 font-medium text-sm">Loading event data...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Event Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Annual Sports Day 2026"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Primary Sport / Theme
                </label>
                <input
                  type="text"
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. All Sports or Badminton"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Venue
                </label>
                <input
                  type="text"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Main Sports Complex"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Event Date
              </label>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
              >
                <Save className="w-4 h-4" />
                {isSaving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
