import { cn } from "@/lib/utils";

interface SkeletonProps {
    className?: string;
}

// Base skeleton with shimmer effect
function Skeleton({ className }: SkeletonProps) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-md bg-muted skeleton-shimmer",
                className
            )}
        />
    );
}

// Premium skeleton with gradient shimmer
function SkeletonPremium({ className }: SkeletonProps) {
    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-md bg-muted",
                className
            )}
        >
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
    );
}

// Chat message skeleton
export function SkeletonChatMessage({ isUser = false }: { isUser?: boolean }) {
    return (
        <div className={cn("flex gap-3 p-4", isUser && "flex-row-reverse")}>
            <SkeletonPremium className="h-8 w-8 rounded-full shrink-0" />
            <div className={cn("flex-1 space-y-2", isUser && "flex flex-col items-end")}>
                <SkeletonPremium className="h-4 w-24" />
                <SkeletonPremium className={cn("h-16", isUser ? "w-3/4" : "w-full")} />
            </div>
        </div>
    );
}

// Chat list skeleton (multiple messages)
export function SkeletonChatMessages({ count = 3 }: { count?: number }) {
    return (
        <div className="space-y-2">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonChatMessage key={i} isUser={i % 2 === 1} />
            ))}
        </div>
    );
}

// Sidebar chat item skeleton
export function SkeletonChatItem() {
    return (
        <div className="flex items-center gap-3 px-3 py-2">
            <SkeletonPremium className="h-4 w-4 rounded" />
            <div className="flex-1 space-y-1.5">
                <SkeletonPremium className="h-3.5 w-3/4" />
                <SkeletonPremium className="h-2.5 w-1/2" />
            </div>
        </div>
    );
}

// Sidebar skeleton (full)
export function SkeletonSidebar() {
    return (
        <div className="w-72 border-r bg-sidebar p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <SkeletonPremium className="h-8 w-8 rounded-lg" />
                <SkeletonPremium className="h-8 w-8 rounded-lg" />
            </div>

            {/* Search */}
            <SkeletonPremium className="h-10 w-full rounded-lg" />

            {/* Section header */}
            <SkeletonPremium className="h-3 w-16 mt-4" />

            {/* Chat items */}
            <div className="space-y-1">
                {Array.from({ length: 8 }).map((_, i) => (
                    <SkeletonChatItem key={i} />
                ))}
            </div>
        </div>
    );
}

// Card skeleton
export function SkeletonCard({ hasImage = false }: { hasImage?: boolean }) {
    return (
        <div className="rounded-xl border bg-card p-4 space-y-3 card-hover">
            {hasImage && <SkeletonPremium className="h-32 w-full rounded-lg" />}
            <SkeletonPremium className="h-5 w-3/4" />
            <SkeletonPremium className="h-3 w-full" />
            <SkeletonPremium className="h-3 w-2/3" />
            <div className="flex gap-2 pt-2">
                <SkeletonPremium className="h-8 w-20 rounded-full" />
                <SkeletonPremium className="h-8 w-20 rounded-full" />
            </div>
        </div>
    );
}

// Grid of cards skeleton
export function SkeletonCardGrid({ count = 6, hasImage = true }: { count?: number; hasImage?: boolean }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonCard key={i} hasImage={hasImage} />
            ))}
        </div>
    );
}

// Table skeleton
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
    return (
        <div className="rounded-lg border overflow-hidden">
            {/* Header */}
            <div className="flex gap-4 p-4 bg-muted/50 border-b">
                {Array.from({ length: cols }).map((_, i) => (
                    <SkeletonPremium key={i} className="h-4 flex-1" />
                ))}
            </div>

            {/* Rows */}
            {Array.from({ length: rows }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex gap-4 p-4 border-b last:border-0">
                    {Array.from({ length: cols }).map((_, colIndex) => (
                        <SkeletonPremium
                            key={colIndex}
                            className={cn("h-4 flex-1", colIndex === 0 && "w-1/4 flex-none")}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

// Profile skeleton
export function SkeletonProfile() {
    return (
        <div className="flex items-center gap-4">
            <SkeletonPremium className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
                <SkeletonPremium className="h-5 w-32" />
                <SkeletonPremium className="h-3 w-48" />
            </div>
        </div>
    );
}

// Full page skeleton
export function SkeletonPage() {
    return (
        <div className="min-h-screen flex">
            <SkeletonSidebar />
            <div className="flex-1 p-8 space-y-6">
                <SkeletonProfile />
                <SkeletonPremium className="h-10 w-full max-w-2xl rounded-xl" />
                <SkeletonCardGrid count={3} />
            </div>
        </div>
    );
}

// Input skeleton
export function SkeletonInput() {
    return (
        <div className="space-y-2">
            <SkeletonPremium className="h-3 w-20" />
            <SkeletonPremium className="h-10 w-full rounded-lg" />
        </div>
    );
}

// Form skeleton
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
    return (
        <div className="space-y-6">
            {Array.from({ length: fields }).map((_, i) => (
                <SkeletonInput key={i} />
            ))}
            <SkeletonPremium className="h-10 w-32 rounded-lg" />
        </div>
    );
}

export { Skeleton, SkeletonPremium };
