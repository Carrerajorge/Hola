/**
 * Background Notification Component - ILIAGPT PRO 3.0
 * Toast notifications for background task completion
 */

import React, { useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, MessageSquare } from 'lucide-react';
import { useNotifications, useStreamingStore, BackgroundNotification } from '@/stores/streamingStore';
import { playSuccessSound, playErrorSound, primeNotificationAudio } from '@/lib/notification-sound';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { channelIncludesPush, isWithinQuietHours } from '@/lib/notification-preferences';

interface BackgroundNotificationToastProps {
    notification: BackgroundNotification;
    onDismiss: (id: string) => void;
    onNavigate: (chatId: string) => void;
}

function BackgroundNotificationToast({
    notification,
    onDismiss,
    onNavigate
}: BackgroundNotificationToastProps) {
    const isSuccess = notification.type === 'completed';

    // Auto-dismiss after 8 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(notification.id);
        }, 8000);
        return () => clearTimeout(timer);
    }, [notification.id, onDismiss]);

    const handleClick = useCallback(() => {
        onNavigate(notification.chatId);
        onDismiss(notification.id);
    }, [notification.chatId, notification.id, onNavigate, onDismiss]);

    return (
        <div
            className="liquid-shell relative max-w-[360px] cursor-pointer overflow-hidden rounded-2xl border border-white/14 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.88))] p-4 text-white shadow-[0_28px_80px_rgba(2,6,23,0.45)] animate-in slide-in-from-right-5 fade-in duration-300 transition-all hover:-translate-y-0.5 hover:border-[#A5A0FF]/35"
            onClick={handleClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        >
            <div
                className={`absolute inset-x-0 top-0 h-1 ${
                    isSuccess
                        ? 'bg-[linear-gradient(90deg,rgba(16,185,129,0.9),rgba(52,211,153,0.4))]'
                        : 'bg-[linear-gradient(90deg,rgba(244,63,94,0.9),rgba(251,113,133,0.45))]'
                }`}
            />
            <div className="flex items-start gap-3">
                    <div className={`flex-shrink-0 rounded-2xl border p-2 ${isSuccess ? 'border-emerald-400/25 bg-emerald-500/15 text-emerald-300' : 'border-rose-400/25 bg-rose-500/15 text-rose-300'}`}>
                        {isSuccess ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <MessageSquare className="w-3.5 h-3.5 text-white/55" />
                            <span className="text-sm font-semibold text-white truncate">
                                {notification.chatTitle}
                            </span>
                        </div>
                    <p className="text-xs text-white/70 line-clamp-2">
                        {isSuccess ? 'Tarea completada' : 'Error en la tarea'}
                    </p>
                    {notification.preview && (
                        <p className="mt-1 line-clamp-1 text-xs italic text-white/45">
                            {notification.preview}
                        </p>
                    )}
                    <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
                        Abrir chat
                    </p>
                </div>

                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(notification.id);
                    }}
                    className="flex-shrink-0 rounded-md p-1 text-white/45 transition-colors hover:bg-white/8 hover:text-white/80"
                    aria-label="Dismiss notification"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

interface BackgroundNotificationContainerProps {
    onNavigateToChat: (chatId: string) => void;
}

export function BackgroundNotificationContainer({ onNavigateToChat }: BackgroundNotificationContainerProps) {
  const notifications = useNotifications();
  const dismissNotification = useStreamingStore((s) => s.dismissNotification);
  const { settings } = useSettingsContext();

  const pushEnabled = channelIncludesPush(settings.notifResponses);
  const quietNow = isWithinQuietHours({
    enabled: settings.notifQuietHours,
    start: settings.notifQuietStart,
    end: settings.notifQuietEnd,
  });

  const allowInApp = settings.notifInApp && pushEnabled && !quietNow;
  const allowDesktop = settings.notifDesktop && pushEnabled && !quietNow;

  useEffect(() => {
    primeNotificationAudio();
  }, []);

  // Play sound when new notification arrives
  useEffect(() => {
    if (!settings.notifSound || !pushEnabled || quietNow) return;
    if (notifications.length > 0) {
      const latest = notifications[notifications.length - 1];
      if (Date.now() - latest.timestamp < 1000) {
        // Only play for new notifications (less than 1 second old)
        if (latest.type === 'completed') {
          playSuccessSound();
        } else {
          playErrorSound();
        }
      }
    }
  }, [notifications.length, pushEnabled, quietNow, settings.notifSound]);

  // Send desktop notifications (only when tab is hidden)
  useEffect(() => {
    if (!allowDesktop) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;

    if (notifications.length > 0) {
      const latest = notifications[notifications.length - 1];
      if (Date.now() - latest.timestamp < 1500) {
        try {
          new Notification(latest.type === 'completed' ? 'Tarea completada' : 'Error en la tarea', {
            body: latest.chatTitle,
            icon: '/favicon.png',
            tag: `bg-${latest.type}`,
          });
        } catch {
          // ignore
        }
      }
    }
  }, [allowDesktop, notifications.length]);

    const handleNavigate = useCallback((chatId: string) => {
        // Dispatch event to select chat
        window.dispatchEvent(new CustomEvent('select-chat', {
            detail: { chatId, preserveKey: true }
        }));
        onNavigateToChat(chatId);
    }, [onNavigateToChat]);

  if (!allowInApp || notifications.length === 0) return null;

  return (
    <div className="fixed right-5 top-5 z-[9999] flex flex-col gap-3 pointer-events-auto">
      {notifications.slice(-3).map((notif) => (
        <BackgroundNotificationToast
                    key={notif.id}
                    notification={notif}
                    onDismiss={dismissNotification}
                    onNavigate={handleNavigate}
                />
            ))}
        </div>
    );
}

export default BackgroundNotificationContainer;
