import React, { memo } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

/**
 * Chat Message Skeleton
 * Displays a loading placeholder for a chat message
 */
export const ChatMessageSkeleton = memo(function ChatMessageSkeleton({
  isUser = false,
  className,
}: {
  isUser?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-3 p-4',
        isUser ? 'flex-row-reverse' : '',
        className
      )}
      role="status"
      aria-label="Cargando mensaje"
    >
      {/* Avatar */}
      <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />

      {/* Content */}
      <div className={cn('flex-1 space-y-2', isUser ? 'items-end' : '')}>
        <Skeleton className="h-4 w-24" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-full max-w-[280px]" />
          <Skeleton className="h-4 w-full max-w-[200px]" />
          <Skeleton className="h-4 w-3/4 max-w-[160px]" />
        </div>
      </div>
    </div>
  );
});

/**
 * Chat List Skeleton
 * Displays loading placeholders for the chat list
 */
export const ChatListSkeleton = memo(function ChatListSkeleton({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('space-y-1 p-2', className)}
      role="status"
      aria-label="Cargando lista de chats"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
          <Skeleton className="h-5 w-5 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
});

/**
 * Message List Skeleton
 * Displays loading placeholders for messages
 */
export const MessageListSkeleton = memo(function MessageListSkeleton({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('space-y-4 p-4', className)}
      role="status"
      aria-label="Cargando mensajes"
    >
      {Array.from({ length: count }).map((_, i) => (
        <ChatMessageSkeleton key={i} isUser={i % 2 === 1} />
      ))}
    </div>
  );
});

/**
 * Card Skeleton
 * Generic card loading placeholder
 */
export const CardSkeleton = memo(function CardSkeleton({
  className,
  hasImage = false,
}: {
  className?: string;
  hasImage?: boolean;
}) {
  return (
    <div
      className={cn('rounded-lg border bg-card p-4 space-y-3', className)}
      role="status"
      aria-label="Cargando"
    >
      {hasImage && <Skeleton className="h-32 w-full rounded-md" />}
      <Skeleton className="h-5 w-3/4" />
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
});

/**
 * Table Skeleton
 * Loading placeholder for tables
 */
export const TableSkeleton = memo(function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('w-full', className)}
      role="status"
      aria-label="Cargando tabla"
    >
      {/* Header */}
      <div className="flex gap-4 p-3 border-b">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 p-3 border-b">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              className={cn(
                'h-4 flex-1',
                colIndex === 0 ? 'max-w-[120px]' : ''
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
});

/**
 * Profile Skeleton
 * Loading placeholder for user profiles
 */
export const ProfileSkeleton = memo(function ProfileSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center gap-4', className)}
      role="status"
      aria-label="Cargando perfil"
    >
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
});

/**
 * Document Preview Skeleton
 */
export const DocumentPreviewSkeleton = memo(function DocumentPreviewSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn('p-4 space-y-4', className)}
      role="status"
      aria-label="Cargando documento"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-4"
            style={{ width: `${Math.random() * 40 + 60}%` }}
          />
        ))}
      </div>
    </div>
  );
});

/**
 * Agent Step Skeleton
 */
export const AgentStepSkeleton = memo(function AgentStepSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-start gap-3 p-3 rounded-lg border', className)}
      role="status"
      aria-label="Cargando paso del agente"
    >
      <Skeleton className="h-6 w-6 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full max-w-[200px]" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  );
});

/**
 * Inline Loading Skeleton
 * Small inline loading indicator
 */
export const InlineSkeleton = memo(function InlineSkeleton({
  width = 80,
  className,
}: {
  width?: number;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn('h-4 inline-block', className)}
      style={{ width }}
    />
  );
});

export default {
  ChatMessageSkeleton,
  ChatListSkeleton,
  MessageListSkeleton,
  CardSkeleton,
  TableSkeleton,
  ProfileSkeleton,
  DocumentPreviewSkeleton,
  AgentStepSkeleton,
  InlineSkeleton,
};
