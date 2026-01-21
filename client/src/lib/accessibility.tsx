/**
 * Accessibility Utilities (#8)
 * WCAG 2.1 AA compliance helpers
 */

import React, { useEffect, useRef, useState, useCallback, ReactNode } from 'react';

// ============================================
// ARIA LIVE ANNOUNCER
// ============================================

let announcer: HTMLDivElement | null = null;

function getAnnouncer(): HTMLDivElement {
    if (!announcer && typeof document !== 'undefined') {
        announcer = document.createElement('div');
        announcer.id = 'aria-live-announcer';
        announcer.setAttribute('aria-live', 'polite');
        announcer.setAttribute('aria-atomic', 'true');
        announcer.setAttribute('role', 'status');
        announcer.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
        document.body.appendChild(announcer);
    }
    return announcer!;
}

export function announce(message: string, priority: 'polite' | 'assertive' = 'polite') {
    const announcer = getAnnouncer();
    announcer.setAttribute('aria-live', priority);

    // Clear and set to trigger announcement
    announcer.textContent = '';
    setTimeout(() => {
        announcer.textContent = message;
    }, 50);
}

// React hook for announcements
export function useAnnounce() {
    return useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
        announce(message, priority);
    }, []);
}

// ============================================
// FOCUS TRAP
// ============================================

const FOCUSABLE_ELEMENTS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useFocusTrap(isActive: boolean = true) {
    const containerRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!isActive || !containerRef.current) return;

        // Store previous focus
        previousFocusRef.current = document.activeElement as HTMLElement;

        const container = containerRef.current;
        const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS);
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        // Focus first element
        firstElement?.focus();

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement?.focus();
                }
            } else {
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement?.focus();
                }
            }
        }

        container.addEventListener('keydown', handleKeyDown);

        return () => {
            container.removeEventListener('keydown', handleKeyDown);
            // Restore focus
            previousFocusRef.current?.focus();
        };
    }, [isActive]);

    return containerRef;
}

// ============================================
// FOCUS VISIBLE
// ============================================

export function useFocusVisible() {
    const [isFocusVisible, setIsFocusVisible] = useState(false);
    const [hadKeyboardEvent, setHadKeyboardEvent] = useState(true);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            setHadKeyboardEvent(true);
        }

        function handlePointerDown() {
            setHadKeyboardEvent(false);
        }

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
        };
    }, []);

    const onFocus = useCallback(() => {
        setIsFocusVisible(hadKeyboardEvent);
    }, [hadKeyboardEvent]);

    const onBlur = useCallback(() => {
        setIsFocusVisible(false);
    }, []);

    return { isFocusVisible, focusVisibleProps: { onFocus, onBlur } };
}

// ============================================
// SKIP LINK
// ============================================

export function SkipLink({ targetId, children = 'Saltar al contenido principal' }: {
    targetId: string;
    children?: ReactNode;
}) {
    return (
        <a
            href={`#${targetId}`}
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg"
        >
            {children}
        </a>
    );
}

// ============================================
// ROVING TABINDEX
// ============================================

export function useRovingTabIndex(itemCount: number, orientation: 'horizontal' | 'vertical' = 'vertical') {
    const [activeIndex, setActiveIndex] = useState(0);

    const handleKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
        const isVertical = orientation === 'vertical';
        const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';
        const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';

        if (e.key === prevKey) {
            e.preventDefault();
            setActiveIndex((prev) => (prev - 1 + itemCount) % itemCount);
        } else if (e.key === nextKey) {
            e.preventDefault();
            setActiveIndex((prev) => (prev + 1) % itemCount);
        } else if (e.key === 'Home') {
            e.preventDefault();
            setActiveIndex(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            setActiveIndex(itemCount - 1);
        }
    }, [itemCount, orientation]);

    const getItemProps = useCallback((index: number) => ({
        tabIndex: index === activeIndex ? 0 : -1,
        onKeyDown: (e: React.KeyboardEvent) => handleKeyDown(e, index),
        onFocus: () => setActiveIndex(index),
    }), [activeIndex, handleKeyDown]);

    return { activeIndex, setActiveIndex, getItemProps };
}

// ============================================
// SCREEN READER ONLY
// ============================================

export function VisuallyHidden({ children, as: Component = 'span' }: {
    children: ReactNode;
    as?: keyof JSX.IntrinsicElements;
}) {
    return (
        <Component className="sr-only">
            {children}
        </Component>
    );
}

// ============================================
// ACCESSIBLE ICON BUTTON
// ============================================

import { forwardRef } from 'react';
import { Button, ButtonProps } from '@/components/ui/button';

interface IconButtonProps extends ButtonProps {
    label: string;
    icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ label, icon, ...props }, ref) => {
        return (
            <Button ref={ref} aria-label={label} {...props}>
                {icon}
                <VisuallyHidden>{label}</VisuallyHidden>
            </Button>
        );
    }
);
IconButton.displayName = 'IconButton';

// ============================================
// LIVE REGION FOR STREAMING
// ============================================

export function StreamingLiveRegion({ content, isStreaming }: {
    content: string;
    isStreaming: boolean;
}) {
    const [announced, setAnnounced] = useState('');

    useEffect(() => {
        if (!isStreaming && content && content !== announced) {
            // Announce completion
            announce('Respuesta completada');
            setAnnounced(content);
        }
    }, [content, isStreaming, announced]);

    return (
        <div
            role="status"
            aria-live="polite"
            aria-atomic="false"
            aria-relevant="additions text"
            className="sr-only"
        >
            {isStreaming ? 'Generando respuesta...' : ''}
        </div>
    );
}

// ============================================
// REDUCED MOTION HOOK
// ============================================

export function usePrefersReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        setPrefersReducedMotion(mediaQuery.matches);

        const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

    return prefersReducedMotion;
}

// ============================================
// HEADING LEVEL CONTEXT
// ============================================

const HeadingLevelContext = React.createContext(1);

export function useHeadingLevel() {
    return React.useContext(HeadingLevelContext);
}

export function Section({ children }: { children: ReactNode }) {
    const level = useHeadingLevel();
    return (
        <HeadingLevelContext.Provider value={Math.min(level + 1, 6)}>
            <section>{children}</section>
        </HeadingLevelContext.Provider>
    );
}

export function Heading({ children, className }: { children: ReactNode; className?: string }) {
    const level = useHeadingLevel();
    const Tag = `h${level}` as keyof JSX.IntrinsicElements;
    return <Tag className={className}>{children}</Tag>;
}
