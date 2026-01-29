import React, { Suspense, ComponentType } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LazyLoadErrorBoundary } from '@/components/error-boundaries';

interface LoadingFallbackProps {
  height?: string | number;
  message?: string;
  className?: string;
}

export function LoadingFallback({
  height = '400px',
  message = 'Loading...',
  className
}: LoadingFallbackProps) {
  const h = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center bg-muted/20 rounded-lg border border-border min-h-[100px] h-[var(--fallback-height)]',
        className
      )}
      style={{ '--fallback-height': h } as React.CSSProperties}
      data-testid="lazy-loading-fallback"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function EditorLoadingFallback() {
  return (
    <div
      className="h-full w-full flex items-center justify-center bg-white"
      data-testid="editor-loading-fallback"
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        <p className="text-sm text-gray-500">Loading editor...</p>
      </div>
    </div>
  );
}

export function withLazyLoading<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  FallbackComponent: ComponentType<any> = LoadingFallback,
  fallbackProps: Record<string, any> = {}
): React.LazyExoticComponent<ComponentType<P>> & { Wrapper: React.FC<P> } {
  const LazyComponent = React.lazy(importFn);

  const Wrapper: React.FC<P> = (props) => (
    <Suspense fallback={<FallbackComponent {...fallbackProps} />}>
      <LazyComponent {...props} />
    </Suspense>
  );

  return Object.assign(LazyComponent, { Wrapper });
}

export const LazyPPTEditorShell = React.lazy(() => import('@/components/ppt/PPTEditorShell'));

export function PPTEditorShellLazy(props: { onClose: () => void; onInsertContent?: (insertFn: (content: string) => void) => void; initialShowInstructions?: boolean; initialContent?: string }) {
  return (
    <LazyLoadErrorBoundary
    // componentName removed
    // loadingComponent removed
    >
      <LazyPPTEditorShell {...props} />
    </LazyLoadErrorBoundary>
  );
}

export const EnhancedDocumentEditorLazy = withLazyLoading(
  () => import('@/components/ribbon').then<{ default: ComponentType<any> }>(module => ({ default: module.EnhancedDocumentEditor as any })),
  EditorLoadingFallback
);

export const SpreadsheetEditorLazy = withLazyLoading(
  () => import('@/components/spreadsheet-editor').then<{ default: ComponentType<any> }>(module => ({ default: module.SpreadsheetEditor as any })),
  EditorLoadingFallback
);
