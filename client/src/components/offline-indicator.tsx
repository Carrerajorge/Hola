import { useOnlineStatus } from '../hooks/use-online-status';
import { WifiOff, Wifi, CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OfflineIndicatorProps {
  pendingCount?: number;
  isSyncing?: boolean;
  className?: string;
}

export function OfflineIndicator({ pendingCount = 0, isSyncing = false, className }: OfflineIndicatorProps) {
  const { isOnline } = useOnlineStatus();

  if (isOnline && pendingCount === 0 && !isSyncing) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
        !isOnline
          ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30'
          : isSyncing
          ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30'
          : pendingCount > 0
          ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30'
          : '',
        className
      )}
      data-testid="offline-indicator"
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          <span>Sin conexión</span>
          {pendingCount > 0 && (
            <span className="bg-yellow-500/30 px-1.5 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
        </>
      ) : isSyncing ? (
        <>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Sincronizando...</span>
        </>
      ) : pendingCount > 0 ? (
        <>
          <CloudOff className="w-3.5 h-3.5" />
          <span>{pendingCount} pendientes</span>
        </>
      ) : null}
    </div>
  );
}

export function OfflineBanner() {
  const { isOnline } = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 bg-yellow-500 text-yellow-950 text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2"
      data-testid="offline-banner"
    >
      <WifiOff className="w-4 h-4" />
      Sin conexión - Los mensajes se guardarán y enviarán cuando vuelvas a conectarte
    </div>
  );
}

export function ConnectionStatus() {
  const { isOnline } = useOnlineStatus();

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs',
        isOnline ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
      )}
      data-testid="connection-status"
    >
      {isOnline ? (
        <>
          <Wifi className="w-3 h-3" />
          <span>Conectado</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3" />
          <span>Sin conexión</span>
        </>
      )}
    </div>
  );
}
