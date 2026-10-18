"use client";

import { useState, useEffect, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bell, Check, Clock, Trophy, CheckCheck, Inbox, RefreshCw } from "lucide-react";
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
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [matchResponses, setMatchResponses] = useState<Record<string, { response: string; respondedAt: string }>>({});
  const [editingResponseMatchId, setEditingResponseMatchId] = useState<string | null>(null);
  const [submittingMatchId, setSubmittingMatchId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

  // Helper to check duplicate notifications
  const isDuplicateNotification = (list: NotificationItem[], item: NotificationItem) => {
    return list.some(
      (n) =>
        n.id === item.id ||
        (n.match_id && item.match_id && n.match_id === item.match_id && n.player_id === item.player_id)
    );
  };

  // Helper to fetch player's current responses for matches in notifications
  const loadMatchResponses = async (items: NotificationItem[]) => {
    if (!playerId) return;
    const matchIds = Array.from(new Set(items.map((n) => n.match_id).filter(Boolean))) as string[];
    if (matchIds.length === 0) return;

    try {
      const mapping: Record<string, { response: string; respondedAt: string }> = {};

      // 1. Try relational match_player_responses table
      const { data: dbResps } = await supabase
        .from('match_player_responses')
        .select('match_id, response, responded_at')
        .eq('player_id', playerId)
        .in('match_id', matchIds);

      if (dbResps && dbResps.length > 0) {
        dbResps.forEach((r: any) => {
          mapping[r.match_id] = {
            response: r.response,
            respondedAt: r.responded_at
          };
        });
      }

      // 2. Fallback to matches.score JSON for any matches not in relational table
      const missingMatchIds = matchIds.filter((mId) => !mapping[mId]);
      if (missingMatchIds.length > 0) {
        const { data: matches } = await supabase
          .from('matches')
          .select('id, score')
          .in('id', missingMatchIds);

        matches?.forEach((m: any) => {
          try {
            const meta = typeof m.score === 'string' ? JSON.parse(m.score) : m.score;
            if (meta?.player_responses?.[playerId]) {
              mapping[m.id] = {
                response: meta.player_responses[playerId].response,
                respondedAt: meta.player_responses[playerId].responded_at
              };
            }
          } catch {}
        });
      }

      setMatchResponses((prev) => ({ ...prev, ...mapping }));
    } catch (err) {
      console.error('Error loading match responses:', err);
    }
  };

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
          await loadMatchResponses(data.notifications);
        }
      } catch (err) {
        console.error('Error fetching notifications:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchNotifications();
  }, [playerId]);

  const handleMatchResponse = async (matchId: string, response: 'COMING' | 'NOT_COMING') => {
    if (!playerId || submittingMatchId === matchId) return;

    const currentResp = matchResponses[matchId]?.response;
    if (currentResp === response && editingResponseMatchId !== matchId) {
      return;
    }

    setSubmittingMatchId(matchId);

    // Optimistic UI update
    setMatchResponses((prev) => ({
      ...prev,
      [matchId]: {
        response,
        respondedAt: new Date().toISOString()
      }
    }));
    setEditingResponseMatchId(null);

    const confirmationText = response === 'COMING' ? "Response recorded: I'm Coming" : "Response recorded: Can't Make It";
    setToastMessage(confirmationText);
    setTimeout(() => {
      setToastMessage((cur) => (cur === confirmationText ? null : cur));
    }, 4000);

    try {
      const res = await fetch('/api/player/matches/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId,
          playerId,
          response
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to record response. Please try again.');
        if (currentResp) {
          setMatchResponses((prev) => ({
            ...prev,
            [matchId]: { response: currentResp, respondedAt: new Date().toISOString() }
          }));
        }
      }
    } catch (err: any) {
      console.error('Error submitting match response:', err);
      alert('Network error submitting response. Please check your connection.');
    } finally {
      setSubmittingMatchId(null);
    }
  };

  // Real-time notification subscription
  useEffect(() => {
    if (!playerId) return;

    const channelName = `player-notifications-${playerId}`;
    const channel = supabase.channel(channelName);

    // 1. Listen for instant broadcast events sent by the server
    channel.on('broadcast', { event: 'new-notification' }, (payload: any) => {
      const incoming = payload.payload as NotificationItem;
      if (!incoming) return;

      setNotifications((prev) => {
        if (isDuplicateNotification(prev, incoming)) return prev;
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
          if (isDuplicateNotification(prev, newRecord)) return prev;
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
      async (payload: any) => {
        const match = payload?.new || payload?.old;
        if (
          !match ||
          match.team1_p1_id === playerId ||
          match.team1_p2_id === playerId ||
          match.team2_p1_id === playerId ||
          match.team2_p2_id === playerId
        ) {
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
    <div className="p-4 space-y-5 pb-24 max-w-md mx-auto relative">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full px-4 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-gray-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 border border-gray-700">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-black">{toastMessage}</span>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-gray-400 hover:text-white text-xs font-bold"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href={`/player/dashboard?id=${playerId}`}
          className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              if (isRefreshing || !playerId) return;
              setIsRefreshing(true);
              try {
                const res = await fetch(`/api/player/notifications?playerId=${playerId}`);
                const data = await res.json();
                if (data.notifications) {
                  setNotifications(data.notifications);
                  setUnreadCount(data.unreadCount || 0);
                  await loadMatchResponses(data.notifications);
                }
              } catch (err) {
                console.error('Error refreshing notifications:', err);
              } finally {
                setIsRefreshing(false);
              }
            }}
            disabled={isRefreshing}
            className="text-xs font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1 disabled:opacity-50"
            title="Refresh notifications"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {unreadCount > 0 && (
            <button
              onClick={() => markAsRead()}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          )}
        </div>
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

                <div className="flex-1 min-w-0 space-y-2">
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

                  {/* Two-Way Match Response Action for MATCH_CALLED notifications */}
                  {n.type === 'MATCH_CALLED' && n.match_id && (() => {
                    const matchResp = matchResponses[n.match_id];
                    const isEditing = editingResponseMatchId === n.match_id;
                    const isSubmitting = submittingMatchId === n.match_id;

                    if (matchResp && !isEditing) {
                      const isComing = matchResp.response === 'COMING';
                      return (
                        <div
                          className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                            isComing
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2">
                            {isComing ? (
                              <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0">
                                <Check className="w-3.5 h-3.5" />
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-900/60 flex items-center justify-center text-rose-700 dark:text-rose-300 shrink-0">
                                <span className="text-xs font-black">✕</span>
                              </div>
                            )}
                            <div>
                              <div className="text-[11px] font-black">
                                {isComing ? "Response recorded: I'm Coming" : "Response recorded: Can't Make It"}
                              </div>
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                                Recorded {formatTime(matchResp.respondedAt)}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setEditingResponseMatchId(n.match_id!)}
                            className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 hover:underline px-2.5 py-1 rounded-lg hover:bg-white/70 dark:hover:bg-zinc-800 transition-colors shrink-0"
                          >
                            Change
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div
                        className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="text-[10px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Match Availability
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleMatchResponse(n.match_id!, 'COMING')}
                            className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" /> I&apos;M COMING
                          </button>
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleMatchResponse(n.match_id!, 'NOT_COMING')}
                            className="flex-1 py-2 px-3 bg-white dark:bg-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 disabled:opacity-50 font-black text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
                          >
                            CAN&apos;T MAKE IT
                          </button>
                        </div>
                        {isEditing && (
                          <div className="text-right">
                            <button
                              type="button"
                              onClick={() => setEditingResponseMatchId(null)}
                              className="text-[10px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

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
