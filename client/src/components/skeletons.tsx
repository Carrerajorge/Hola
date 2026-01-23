/**
 * Skeleton Components
 * 
 * Skeleton loading states for:
 * - Chat messages
 * - Sidebar items
 * - Cards
 * - Tables
 */

import React from 'react';

interface SkeletonProps {
    className?: string;
    style?: React.CSSProperties;
}

// Base skeleton with animation
export function Skeleton({ className = '', style }: SkeletonProps) {
    return (
        <div
            className={`animate-pulse bg-muted/60 rounded ${className}`}
            style={style}
        />
    );
}

// Text skeleton (single line)
export function SkeletonText({ width = '100%' }: { width?: string | number }) {
    return <Skeleton className="h-4" style={{ width }} />;
}

// Chat message skeleton
export function SkeletonMessage({ isUser = false }: { isUser?: boolean }) {
    return (
        <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
            <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
            <div className={`flex-1 space-y-2 ${isUser ? 'items-end' : ''} max-w-[70%]`}>
                <Skeleton className="h-4 w-24" />
                <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                </div>
            </div>
        </div>
    );
}

// Chat list skeleton (multiple messages)
export function SkeletonChatMessages({ count = 3, className = '' }: { count?: number; className?: string }) {
    return (
        <div className={`space-y-6 ${className}`}>
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonMessage key={i} isUser={i % 2 === 0} />
            ))}
        </div>
    );
}

// Sidebar chat item skeleton
export function SkeletonSidebarItem() {
    return (
        <div className="flex items-center gap-3 p-2 rounded-lg">
            <Skeleton className="w-5 h-5 rounded" />
            <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
            </div>
        </div>
    );
}

// Sidebar skeleton (multiple items)
export function SkeletonSidebar({ count = 8 }: { count?: number }) {
    return (
        <div className="space-y-1 p-2">
            {/* Header */}
            <div className="flex items-center justify-between p-2 mb-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-8 w-8 rounded-lg" />
            </div>

            {/* Items */}
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonSidebarItem key={i} />
            ))}
        </div>
    );
}

// Card skeleton
export function SkeletonCard() {
    return (
        <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                </div>
            </div>
            <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
            </div>
            <div className="flex gap-2">
                <Skeleton className="h-8 w-20 rounded-lg" />
                <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
        </div>
    );
}

// Table skeleton
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
    return (
        <div className="rounded-lg border overflow-hidden">
            {/* Header */}
            <div className="flex border-b bg-muted/30 p-3 gap-4">
                {Array.from({ length: cols }).map((_, i) => (
                    <Skeleton key={i} className="h-4 flex-1" />
                ))}
            </div>

            {/* Rows */}
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex p-3 gap-4 border-b last:border-0">
                    {Array.from({ length: cols }).map((_, colIndex) => (
                        <Skeleton
                            key={colIndex}
                            className="h-4 flex-1"
                            style={{ width: `${60 + Math.random() * 40}%` }}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

// Code block skeleton
export function SkeletonCodeBlock() {
    return (
        <div className="rounded-lg bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between mb-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-16 rounded" />
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton
                    key={i}
                    className="h-4"
                    style={{
                        width: `${40 + Math.random() * 50}%`,
                        marginLeft: i % 3 === 0 ? 0 : Math.random() * 24,
                    }}
                />
            ))}
        </div>
    );
}

// Full page skeleton
export function SkeletonPage() {
    return (
        <div className="flex h-screen">
            {/* Sidebar */}
            <div className="w-64 border-r">
                <SkeletonSidebar />
            </div>

            {/* Main content */}
            <div className="flex-1 flex flex-col">
                {/* Header */}
                <div className="h-14 border-b flex items-center justify-between px-4">
                    <Skeleton className="h-6 w-48" />
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <Skeleton className="h-8 w-8 rounded-lg" />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-4">
                    <SkeletonChatMessages count={4} />
                </div>

                {/* Input */}
                <div className="border-t p-4">
                    <Skeleton className="h-12 w-full rounded-lg" />
                </div>
            </div>
        </div>
    );
}
