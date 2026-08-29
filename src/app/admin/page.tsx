"use client";

import { useEffect, useState, useMemo } from "react";
import { Users, UserCheck, Activity, AlertTriangle, ArrowRight, Trophy } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    registered: 0,
    present: 0,
    liveMatches: 0,
    alerts: 0,
    completedMatches: 0,
  });
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function fetchStats() {
      const { data: events } = await supabase.from('events').select('id').limit(1);
      const currentEventId = events && events.length > 0 ? events[0].id : null;

      let reg = 0;
      let pres = 0;

      if (currentEventId) {
        const { count: r } = await supabase
          .from('players')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', currentEventId);

        const { count: p } = await supabase
          .from('players')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', currentEventId)
          .neq('status', 'REGISTERED')
          .neq('status', 'ABSENT');

        reg = r || 0;
        pres = p || 0;
      }

      let matchesQuery = supabase.from('matches').select('status');
      if (currentEventId) {
        matchesQuery = matchesQuery.or(`event_id.eq.${currentEventId},event_id.is.null`);
      }
      const { data: matches } = await matchesQuery;

      let live = 0;
      let alerts = 0;
      let completed = 0;

      if (matches) {
        live = matches.filter((m) => m.status === 'LIVE').length;
        alerts = matches.filter(
          (m) => m.status === 'NO-SHOW PENDING' || m.status === 'PLAYER_UNAVAILABLE'
        ).length;
        completed = matches.filter((m) => m.status === 'COMPLETED').length;
      }

      setStats({
        registered: reg,
        present: pres,
        liveMatches: live,
        alerts,
        completedMatches: completed,
      });
    }

    fetchStats();

    const channel = supabase
      .channel('admin_stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => fetchStats())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const statCards = [
    { title: "Total Registered", value: stats.registered, icon: Users, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20" },
    { title: "Checked In Today", value: stats.present, icon: UserCheck, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
    { title: "Live Matches", value: stats.liveMatches, icon: Activity, color: "text-purple-500", bg: "bg-purple-50 dark:bg-purple-900/20" },
    { title: "Total Matches Played", value: stats.completedMatches, icon: Trophy, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20" },
    { title: "Action Required", value: stats.alerts, icon: AlertTriangle, color: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-900/20" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-white">Overview</h1>
        <p className="text-gray-500 font-medium text-sm mt-1">Real-time statistics and match-day status.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 2xl:grid-cols-5 gap-5">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          const spanClass =
            i < 3
              ? "col-span-1 sm:col-span-1 lg:col-span-2 2xl:col-span-1"
              : i === 4
              ? "col-span-1 sm:col-span-2 lg:col-span-3 2xl:col-span-1"
              : "col-span-1 sm:col-span-1 lg:col-span-3 2xl:col-span-1";

          return (
            <div
              key={i}
              className={`${spanClass} p-5 rounded-2xl border-2 flex items-center gap-4.5 ${stat.bg} border-gray-100 dark:border-zinc-800 shadow-sm transition-transform hover:scale-[1.01] min-h-[104px]`}
            >
              <div className={`p-3.5 rounded-xl bg-white dark:bg-zinc-800 shadow-sm ${stat.color} shrink-0`}>
                <Icon className="w-7 h-7" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider leading-snug break-words">
                  {stat.title}
                </p>
                <h3 className="text-3xl font-black mt-1 text-gray-900 dark:text-white tracking-tight leading-none">
                  {stat.value}
                </h3>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <Link href="/admin/players" className="group p-8 rounded-3xl border-2 border-gray-100 hover:border-blue-300 bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md transition-all flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-gray-900 dark:text-white group-hover:text-blue-500 transition-colors">Manage Players</h2>
            <p className="text-sm font-medium text-gray-500 mt-2">Import registrations and view check-ins.</p>
          </div>
          <ArrowRight className="text-gray-300 group-hover:text-blue-500 w-8 h-8 transition-colors" />
        </Link>

        <Link href="/admin/matches" className="group p-8 rounded-3xl border-2 border-gray-100 hover:border-purple-300 bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md transition-all flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-gray-900 dark:text-white group-hover:text-purple-500 transition-colors">Play Area Management</h2>
            <p className="text-sm font-medium text-gray-500 mt-2">Monitor live playing areas, schedule fixtures, and track player responses.</p>
          </div>
          <ArrowRight className="text-gray-300 group-hover:text-purple-500 w-8 h-8 transition-colors" />
        </Link>
      </div>
    </div>
  );
}
