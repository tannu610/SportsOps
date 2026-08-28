"use client";

import { useState, useEffect, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bell, Check, Clock, Trophy, CheckCheck, Inbox } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

interface NotificationItem {
  id: string;
  player_id: string;
  match_id?: string | null;
  message: string;
  type: string;
  sent_at: string;
  read: boolean;
}

function NotificationsContent() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const rawId = searchParams.get('id');

  const [playerId, setPlayerId] = useState<string | null>(rawId);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  // Sync playerId from URL searchParams or localStorage
  useEffect(() => {
    if (rawId) {
      setPlayerId(rawId);
      if (typeof window !== 'undefined') {
        localStorage.setItem('sports_player_id', rawId);
      }
    } else if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sports_player_id');
      if (stored) setPlayerId(stored);
    }
  }, [rawId]);

  // Initial load of notifications
  useEffect(() => {
    if (!playerId) {
      setIsLoading(false);
      return;
    }

    async function fetchNotifications() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/player/notifications?playerId=${playerId}`);
        const data = await res.json();
        if (data.notifications) {
          setNotifications(data.notifications);
          setUnreadCount(data.unreadCount || 0);
        }
      } catch (err) {
        console.error('Error fetching notifications:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchNotifications();
  }, [playerId]);

  // Real-time notification subscription
  useEffect(() => {
    if (!playerId) return;

    const channelName = `player-notifications-${playerId}`;
    const channel = supabase.channel(channelName);

    // 1. Listen for instant broadcast events sent by the server
    channel.on('broadcast', { event: 'new-notification' }, (payload: any) => {
      const incoming = payload.payload;
      if (!incoming) return;

      setNotifications((prev) => {
        // Prevent duplicates
        const exists = prev.some((n) => n.id === incoming.id);
        if (exists) return prev;
        return [incoming, ...prev];
      });

      if (!incoming.read) {
        setUnreadCount((prev) => prev + 1);
      }
    });

    // 2. Listen for PostgreSQL database changes on notifications table
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `player_id=eq.${playerId}`
      },
      (payload) => {
        const newRecord = payload.new as NotificationItem;
        if (!newRecord) return;

        setNotifications((prev) => {
          const exists = prev.some((n) => n.id === newRecord.id);
          if (exists) return prev;
          return [newRecord, ...prev];
        });

        if (!newRecord.read) {
          setUnreadCount((prev) => prev + 1);
        }
      }
    );

    // 3. Listen for notification updates (e.g. read status changes)
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `player_id=eq.${playerId}`
      },
      (payload) => {
        const updated = payload.new as NotificationItem;
        if (!updated) return;

        setNotifications((prev) =>
          prev.map((n) => (n.id === updated.id ? updated : n))
        );

        // Recalculate unread count
        setNotifications((current) => {
          setUnreadCount(current.filter((n) => !n.read).length);
          return current;
        });
      }
    );

    // 4. Also listen for matches table updates (in case match status changes to NOTIFIED)
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'matches'
      },
      async () => {
        // Re-fetch notifications in background to keep in sync
        try {
          const res = await fetch(`/api/player/notifications?playerId=${playerId}`);
          const data = await res.json();
          if (data.notifications) {
            setNotifications(data.notifications);
            setUnreadCount(data.unreadCount || 0);
          }
        } catch (err) {
          console.error('Error refreshing notifications:', err);
        }
      }
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [playerId, supabase]);

  const markAsRead = async (notificationId?: string) => {
    if (!playerId) return;

    // Optimistic UI update
    if (notificationId) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } else {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    }

    try {
      await fetch('/api/player/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          notificationId,
          markAll: !notificationId
        })
      });
    } catch (err) {
      console.error('Failed to update read status', err);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const filteredNotifications =
    filter === 'unread'
      ? notifications.filter((n) => !n.read)
      : notifications;

  if (!playerId) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-gray-500 font-medium">Please check in first to view your notifications.</p>
        <Link
          href="/player/check-in"
          className="inline-block px-5 py-2.5 bg-blue-600 text-white font-bold rounded-xl text-sm hover:bg-blue-700"
        >
          Go to Check-In
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 pb-24 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href={`/player/dashboard?id=${playerId}`}
          className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
        {unreadCount > 0 && (
          <button
            onClick={() => markAsRead()}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900 dark:text-white">Notifications</h1>
            <p className="text-xs text-gray-400 font-medium">Real-time match alerts & updates</p>
          </div>
        </div>

        <span
          id="notification-badge"
          className={`px-3 py-1 rounded-full text-xs font-black tracking-wide ${
            unreadCount > 0
              ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-200'
              : 'bg-gray-100 dark:bg-zinc-800 text-gray-500'
          }`}
        >
          {unreadCount > 0 ? `${unreadCount} New` : 'All read'}
        </span>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 p-1 bg-gray-100 dark:bg-zinc-900 rounded-xl">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
            filter === 'all'
              ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
            filter === 'unread'
              ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          Unread ({unreadCount})
        </button>
      </div>

      {/* Notification List */}
      {isLoading ? (
        <div className="p-12 text-center text-gray-400 text-sm font-medium">
          Loading notifications...
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="p-12 text-center border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl space-y-3">
          <div className="w-12 h-12 bg-gray-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mx-auto text-gray-400">
            <Inbox className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-gray-600 dark:text-gray-400">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </p>
          <p className="text-xs text-gray-400">
            Match calls and schedule alerts will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-3" id="notifications-list">
          {filteredNotifications.map((n) => (
            <div
              key={n.id}
              onClick={() => {
                if (!n.read) markAsRead(n.id);
              }}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                !n.read
                  ? 'bg-white dark:bg-zinc-900 border-blue-200 dark:border-blue-800 shadow-md shadow-blue-50/50 relative overflow-hidden'
                  : 'bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800 hover:border-gray-200 opacity-80'
              }`}
            >
              {!n.read && (
                <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-blue-600" />
              )}

              <div className="flex gap-3 items-start">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    !n.read
                      ? 'bg-blue-100 dark:bg-blue-950 text-blue-600'
                      : 'bg-gray-100 dark:bg-zinc-800 text-gray-400'
                  }`}
                >
                  <Trophy className="w-4 h-4" />
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      {n.type === 'MATCH_CALLED' ? 'Match Called' : 'Update'}
                    </span>
                    <span className="text-[10px] font-medium text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatTime(n.sent_at)}
                    </span>
                  </div>

                  <p className="text-xs font-bold text-gray-800 dark:text-zinc-200 leading-relaxed">
                    {n.message}
                  </p>

                  <div className="pt-2 flex items-center justify-between">
                    <Link
                      href={`/player/dashboard?id=${playerId}`}
                      className="text-[11px] font-black text-blue-600 hover:underline"
                    >
                      Go to Dashboard →
                    </Link>
                    {!n.read && (
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-600" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlayerNotificationsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading notifications...</div>}>
      <NotificationsContent />
    </Suspense>
  );
}
