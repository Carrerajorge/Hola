# 10 Mejoras Críticas de Frontend - ILIAGPT

> **Fecha:** 2026-01-28
> **Análisis basado en:** 318 componentes React, ~105k LOC

---

## Resumen Ejecutivo

Este documento presenta 10 mejoras críticas identificadas tras un análisis exhaustivo del frontend de ILIAGPT. Las mejoras están ordenadas por impacto y urgencia, abordando problemas de mantenibilidad, rendimiento, accesibilidad y experiencia de usuario.

---

## 1. Refactorización de Componentes Gigantes

### Problema
Los componentes más grandes del proyecto exceden los límites recomendados de mantenibilidad:

| Componente | Líneas | Riesgo |
|-----------|--------|--------|
| `chat-interface.tsx` | 5,885 | 🔴 Crítico |
| `admin.tsx` | 5,013 | 🔴 Crítico |
| `spreadsheet-editor.tsx` | 2,747 | 🟡 Alto |
| `settings-dialog.tsx` | 2,128 | 🟡 Alto |

### Impacto
- Dificultad extrema para debugging
- Testing prácticamente imposible
- Code reviews ineficientes
- Alto riesgo de regresiones

### Solución Propuesta

```typescript
// Antes: chat-interface.tsx (5,885 líneas)
export const ChatInterface = () => { /* TODO el código */ }

// Después: Dividir en módulos especializados
client/src/components/chat-interface/
├── index.tsx                    // Componente principal (~200 líneas)
├── ChatHeader.tsx               // Header con controles
├── MessageList.tsx              // Lista virtualizada
├── MessageItem.tsx              // Mensaje individual
├── MessageInput.tsx             // Input de mensajes
├── StreamingIndicator.tsx       // Indicador de streaming
├── ChatActions.tsx              // Acciones del chat
├── hooks/
│   ├── useChatMessages.ts       // Lógica de mensajes
│   ├── useChatStreaming.ts      // Lógica de streaming
│   └── useChatKeyboard.ts       // Atajos de teclado
└── types.ts                     // Tipos específicos
```

### Métricas de Éxito
- [ ] Ningún componente > 500 líneas
- [ ] Cada componente tiene una sola responsabilidad
- [ ] Cobertura de tests > 80%

---

## 2. Implementación de Testing del Cliente

### Problema
**No existen tests para el frontend.** El directorio `client/` no contiene archivos `.test.tsx` o `.spec.tsx`.

### Impacto
- Sin garantía de funcionamiento tras cambios
- Regresiones frecuentes en producción
- Refactoring arriesgado
- Deuda técnica acumulada

### Solución Propuesta

```typescript
// Configuración Vitest + React Testing Library
// vitest.config.ts
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      threshold: {
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});

// Ejemplo de test para un hook
// hooks/__tests__/useChatStore.test.ts
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from '../useChatStore';

describe('useChatStore', () => {
  it('should add a new message', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.addMessage({
        id: '1',
        content: 'Hello',
        role: 'user',
      });
    });

    expect(result.current.messages.get('default')).toHaveLength(1);
  });
});
```

### Prioridad de Tests
1. **Stores de Zustand** - Core de la aplicación
2. **Hooks personalizados** - Lógica reutilizable
3. **Componentes críticos** - Chat, Auth, Forms
4. **Flujos E2E** - Login, envío de mensajes

### Métricas de Éxito
- [ ] Cobertura mínima 80% en stores
- [ ] Tests para todos los hooks
- [ ] Tests E2E para flujos críticos

---

## 3. Auditoría y Remediación de Accesibilidad

### Problema
La accesibilidad está parcialmente implementada pero incompleta:

- ❌ Falta `aria-expanded` en dropdowns y accordions
- ❌ Falta `aria-haspopup` en menús contextuales
- ❌ Imágenes sin atributo `alt`
- ❌ Algunos formularios sin labels asociados
- ❌ Navegación por teclado incompleta en componentes complejos

### Impacto
- Usuarios con discapacidades no pueden usar la aplicación
- Incumplimiento de WCAG 2.1 AA
- Potencial riesgo legal en algunos mercados
- Exclusión de ~15% de usuarios potenciales

### Solución Propuesta

```typescript
// 1. Agregar jest-axe para testing automatizado
// setup.ts
import { toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);

// 2. Test de accesibilidad
import { axe } from 'jest-axe';

it('ChatInterface should have no accessibility violations', async () => {
  const { container } = render(<ChatInterface />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

// 3. Componente Dropdown mejorado
const Dropdown = ({ label, options, ...props }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={label}
        onClick={() => setIsOpen(!isOpen)}
      >
        {label}
      </button>
      {isOpen && (
        <ul role="listbox" aria-label={`${label} options`}>
          {options.map((option, i) => (
            <li
              key={i}
              role="option"
              aria-selected={option.selected}
              tabIndex={0}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

### Checklist de Remediación
- [ ] Auditoría con axe DevTools
- [ ] Agregar `alt` a todas las imágenes
- [ ] Implementar `aria-expanded` en elementos colapsables
- [ ] Focus visible en todos los elementos interactivos
- [ ] Orden de tabulación lógico
- [ ] Skip links funcionales
- [ ] Modo alto contraste completo

---

## 4. Optimización de Bundle y Lazy Loading Interno

### Problema
Solo las páginas tienen lazy loading. Los componentes internos pesados se cargan todos al inicio:

- Monaco Editor: ~2MB
- Handsontable: ~1.5MB
- Mermaid: ~800KB
- Three.js: ~600KB

### Impacto
- First Contentful Paint lento
- Time to Interactive elevado
- Usuarios en conexiones lentas abandonan
- Puntuación baja en Core Web Vitals

### Solución Propuesta

```typescript
// 1. Lazy loading de editores pesados
// components/editors/LazyMonaco.tsx
const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then(mod => ({ default: mod.Editor }))
);

export const LazyMonaco = (props: MonacoProps) => (
  <Suspense fallback={<EditorSkeleton />}>
    <MonacoEditor {...props} />
  </Suspense>
);

// 2. Dynamic imports condicionales
// Solo cargar Three.js si se necesita
const loadThreeJS = async () => {
  const THREE = await import('three');
  return THREE;
};

// 3. Route-based code splitting mejorado
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-core': ['react', 'react-dom', 'wouter'],
        'vendor-ui': ['@radix-ui/react-*', 'lucide-react'],
        'vendor-charts': ['recharts', 'echarts'],
        'vendor-office': ['docx', 'pptxgenjs', 'xlsx'],
        'vendor-editors': ['@monaco-editor/react', '@tiptap/*'],
        'vendor-3d': ['three', 'konva'],
      },
    },
  },
},

// 4. Prefetching inteligente
// En el router, prefetch de rutas probables
<Route path="/workspace" component={() => {
  // Prefetch admin si es admin user
  if (user.isAdmin) {
    import('../pages/admin');
  }
  return <Workspace />;
}} />
```

### Métricas de Éxito
- [ ] Bundle inicial < 500KB (gzipped)
- [ ] LCP < 2.5s
- [ ] TTI < 3.8s
- [ ] Bundle analysis en CI/CD

---

## 5. Sistema de Gestión de Errores Unificado

### Problema
El manejo de errores es inconsistente:
- Algunos componentes tienen Error Boundaries, otros no
- Mensajes de error genéricos ("Something went wrong")
- Sin tracking centralizado de errores del cliente
- Sin recovery automático para errores transitorios

### Impacto
- Usuarios frustrados sin saber qué pasó
- Debugging difícil en producción
- Pérdida de datos por errores no manejados
- Sin métricas de estabilidad del cliente

### Solución Propuesta

```typescript
// 1. Error Boundary global mejorado
// components/error-boundaries/GlobalErrorBoundary.tsx
interface ErrorState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
  retryCount: number;
}

class GlobalErrorBoundary extends Component<Props, ErrorState> {
  static getDerivedStateFromError(error: Error): Partial<ErrorState> {
    const errorId = `err_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Enviar a servicio de tracking
    trackError({
      errorId,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    });

    return { error, errorId };
  }

  handleRetry = () => {
    if (this.state.retryCount < 3) {
      this.setState(prev => ({
        error: null,
        retryCount: prev.retryCount + 1,
      }));
    }
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          errorId={this.state.errorId}
          onRetry={this.handleRetry}
          canRetry={this.state.retryCount < 3}
        />
      );
    }
    return this.props.children;
  }
}

// 2. Hook para manejo de errores async
const useAsyncError = () => {
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async <T,>(
    promise: Promise<T>,
    options?: { onError?: (e: Error) => void }
  ): Promise<T | null> => {
    try {
      return await promise;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      setError(error);
      options?.onError?.(error);
      return null;
    }
  }, []);

  return { error, execute, clearError: () => setError(null) };
};

// 3. Mensajes de error específicos
const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'No se pudo conectar al servidor. Verifica tu conexión.',
  AUTH_ERROR: 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.',
  RATE_LIMIT: 'Has realizado demasiadas solicitudes. Espera un momento.',
  VALIDATION_ERROR: 'Los datos ingresados no son válidos.',
  SERVER_ERROR: 'Error del servidor. Estamos trabajando en solucionarlo.',
  DEFAULT: 'Ocurrió un error inesperado. Intenta nuevamente.',
};
```

### Métricas de Éxito
- [ ] 100% de componentes críticos con Error Boundary
- [ ] Tracking de errores implementado
- [ ] Mensajes de error específicos y accionables
- [ ] Tasa de crashes < 0.1%

---

## 6. Optimización de Formularios y Validación

### Problema
- Validación inconsistente (algunos usan Zod, otros no)
- Sin sanitización de inputs (riesgo XSS)
- Feedback de errores tardío (solo al submit)
- Sin validación en tiempo real

### Impacto
- Mala UX en formularios
- Riesgo de seguridad XSS
- Frustración del usuario
- Datos inválidos llegando al backend

### Solución Propuesta

```typescript
// 1. Schema de validación centralizado
// lib/validation/schemas.ts
import { z } from 'zod';
import DOMPurify from 'dompurify';

// Sanitizador reutilizable
const sanitizedString = z.string().transform(val => DOMPurify.sanitize(val));

export const messageSchema = z.object({
  content: sanitizedString
    .min(1, 'El mensaje no puede estar vacío')
    .max(10000, 'El mensaje es demasiado largo'),
  attachments: z.array(z.string().url()).max(5).optional(),
});

export const userSettingsSchema = z.object({
  name: sanitizedString.min(2).max(100),
  email: z.string().email('Email inválido'),
  theme: z.enum(['light', 'dark', 'system']),
  language: z.enum(['es', 'en', 'pt']),
});

// 2. Hook de formulario mejorado
// hooks/useValidatedForm.ts
export const useValidatedForm = <T extends z.ZodSchema>(
  schema: T,
  options?: UseFormOptions<z.infer<T>>
) => {
  const form = useForm<z.infer<T>>({
    resolver: zodResolver(schema),
    mode: 'onChange', // Validación en tiempo real
    ...options,
  });

  return {
    ...form,
    // Helper para mostrar errores inline
    getFieldError: (name: keyof z.infer<T>) =>
      form.formState.errors[name]?.message as string | undefined,
    // Helper para estado del campo
    getFieldState: (name: keyof z.infer<T>) => ({
      isValid: !form.formState.errors[name],
      isDirty: form.formState.dirtyFields[name],
      isTouched: form.formState.touchedFields[name],
    }),
  };
};

// 3. Componente de campo con validación visual
// components/ui/ValidatedField.tsx
export const ValidatedField = ({
  name,
  label,
  form,
  ...props
}: ValidatedFieldProps) => {
  const error = form.getFieldError(name);
  const { isValid, isDirty } = form.getFieldState(name);

  return (
    <FormField name={name} control={form.control}>
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <Input
            {...props}
            aria-invalid={!!error}
            aria-describedby={error ? `${name}-error` : undefined}
            className={cn(
              isDirty && isValid && 'border-green-500',
              error && 'border-red-500'
            )}
          />
        </FormControl>
        {isDirty && isValid && (
          <CheckCircle className="text-green-500 h-4 w-4" />
        )}
        <FormMessage id={`${name}-error`} />
      </FormItem>
    </FormField>
  );
};
```

### Métricas de Éxito
- [ ] 100% de formularios con validación Zod
- [ ] Sanitización en todos los inputs de texto
- [ ] Feedback visual en tiempo real
- [ ] 0 vulnerabilidades XSS

---

## 7. Implementación de Skeleton Loading y Estados de Carga

### Problema
- Spinners genéricos en lugar de skeleton screens
- Sin indicación de progreso en operaciones largas
- Cambios bruscos de layout (CLS alto)
- Sin optimistic updates

### Impacto
- Percepción de lentitud
- Cumulative Layout Shift elevado
- Usuarios impacientes abandonan
- Experiencia poco profesional

### Solución Propuesta

```typescript
// 1. Skeleton components específicos
// components/skeletons/ChatSkeleton.tsx
export const ChatMessageSkeleton = () => (
  <div className="flex gap-3 p-4 animate-pulse">
    <Skeleton className="h-10 w-10 rounded-full" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  </div>
);

export const ChatListSkeleton = ({ count = 5 }) => (
  <div className="space-y-4">
    {Array.from({ length: count }).map((_, i) => (
      <ChatMessageSkeleton key={i} />
    ))}
  </div>
);

// 2. Componente de contenido con loading state
// components/ui/AsyncContent.tsx
interface AsyncContentProps<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  skeleton: React.ReactNode;
  children: (data: T) => React.ReactNode;
}

export const AsyncContent = <T,>({
  data,
  isLoading,
  error,
  skeleton,
  children,
}: AsyncContentProps<T>) => {
  if (isLoading) return <>{skeleton}</>;
  if (error) return <ErrorDisplay error={error} />;
  if (!data) return <EmptyState />;
  return <>{children(data)}</>;
};

// Uso:
<AsyncContent
  data={messages}
  isLoading={isLoading}
  error={error}
  skeleton={<ChatListSkeleton count={10} />}
>
  {(messages) => <MessageList messages={messages} />}
</AsyncContent>

// 3. Optimistic updates para acciones comunes
// hooks/useOptimisticMessage.ts
export const useOptimisticMessage = () => {
  const queryClient = useQueryClient();

  const sendMessage = useMutation({
    mutationFn: api.sendMessage,
    onMutate: async (newMessage) => {
      await queryClient.cancelQueries({ queryKey: ['messages'] });

      const previousMessages = queryClient.getQueryData(['messages']);

      // Agregar mensaje optimista
      queryClient.setQueryData(['messages'], (old: Message[]) => [
        ...old,
        { ...newMessage, id: `temp-${Date.now()}`, status: 'sending' },
      ]);

      return { previousMessages };
    },
    onError: (err, newMessage, context) => {
      // Rollback en caso de error
      queryClient.setQueryData(['messages'], context?.previousMessages);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  return sendMessage;
};

// 4. Progress indicator para operaciones largas
// components/ui/ProgressOverlay.tsx
export const ProgressOverlay = ({
  progress,
  message
}: {
  progress: number;
  message: string;
}) => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <Card className="w-80 p-6">
      <p className="text-sm text-muted-foreground mb-4">{message}</p>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-right mt-2">{progress}%</p>
    </Card>
  </div>
);
```

### Métricas de Éxito
- [ ] CLS < 0.1
- [ ] Skeleton screens en todas las vistas principales
- [ ] Optimistic updates en operaciones de chat
- [ ] Progress indicators en uploads/exports

---

## 8. Sistema de Internacionalización (i18n) Consistente

### Problema
- Mezcla de textos hardcodeados con i18n
- Sin soporte para RTL (árabe, hebreo)
- Formatos de fecha/número no localizados
- Sin detección automática de idioma

### Impacto
- Imposible escalar a nuevos mercados
- Inconsistencia en la UI
- Usuarios no angloparlantes frustrados
- Mantenimiento costoso de traducciones

### Solución Propuesta

```typescript
// 1. Configuración de i18next mejorada
// lib/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTranslations },
      es: { translation: esTranslations },
      pt: { translation: ptTranslations },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
      format: (value, format, lng) => {
        if (format === 'date') {
          return new Intl.DateTimeFormat(lng).format(value);
        }
        if (format === 'number') {
          return new Intl.NumberFormat(lng).format(value);
        }
        return value;
      },
    },
  });

// 2. Hook para formateo localizado
// hooks/useLocale.ts
export const useLocale = () => {
  const { i18n, t } = useTranslation();

  const formatDate = useCallback((date: Date, options?: Intl.DateTimeFormatOptions) => {
    return new Intl.DateTimeFormat(i18n.language, options).format(date);
  }, [i18n.language]);

  const formatNumber = useCallback((num: number, options?: Intl.NumberFormatOptions) => {
    return new Intl.NumberFormat(i18n.language, options).format(num);
  }, [i18n.language]);

  const formatRelativeTime = useCallback((date: Date) => {
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    const diff = (date.getTime() - Date.now()) / 1000;

    if (Math.abs(diff) < 60) return rtf.format(Math.round(diff), 'second');
    if (Math.abs(diff) < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (Math.abs(diff) < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  }, [i18n.language]);

  return { t, formatDate, formatNumber, formatRelativeTime, language: i18n.language };
};

// 3. Componente de texto traducido con fallback
// components/ui/T.tsx (Translation component)
interface TProps {
  k: string; // key
  values?: Record<string, any>;
  fallback?: string;
}

export const T = ({ k, values, fallback }: TProps) => {
  const { t } = useTranslation();
  const translated = t(k, values);

  // En desarrollo, mostrar warning si falta traducción
  if (process.env.NODE_ENV === 'development' && translated === k) {
    console.warn(`Missing translation: ${k}`);
  }

  return <>{translated === k ? (fallback || k) : translated}</>;
};

// 4. Archivos de traducción tipados
// lib/i18n/types.ts
export interface Translations {
  common: {
    save: string;
    cancel: string;
    delete: string;
    loading: string;
  };
  chat: {
    placeholder: string;
    send: string;
    thinking: string;
  };
  errors: {
    network: string;
    auth: string;
    generic: string;
  };
}
```

### Métricas de Éxito
- [ ] 100% de textos UI en archivos i18n
- [ ] Soporte para 3+ idiomas
- [ ] Fechas y números formateados por locale
- [ ] Tests de traducciones faltantes en CI

---

## 9. Mejoras de Rendimiento en Listas Virtualizadas

### Problema
- `VirtualizedMessageList` no está optimizado para casos extremos
- Re-renders innecesarios en scroll
- Sin recycling de elementos DOM
- Memoria crece con historial largo

### Impacto
- Lag en chats con +1000 mensajes
- Consumo excesivo de memoria
- UI no responsiva en scroll rápido
- Crashes en dispositivos con poca RAM

### Solución Propuesta

```typescript
// 1. Lista virtualizada optimizada con TanStack Virtual
// components/chat/OptimizedMessageList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

export const OptimizedMessageList = ({ messages }: { messages: Message[] }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback((index) => {
      // Estimar altura basada en contenido
      const msg = messages[index];
      const baseHeight = 60;
      const charsPerLine = 80;
      const lines = Math.ceil(msg.content.length / charsPerLine);
      return baseHeight + (lines * 20);
    }, [messages]),
    overscan: 5, // Elementos extra para smooth scroll
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Auto-scroll al final cuando llegan nuevos mensajes
  useEffect(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, [messages.length]);

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{ contain: 'strict' }} // Optimization hint
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <MemoizedMessageItem
              message={messages[virtualItem.index]}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// 2. Mensaje memoizado para evitar re-renders
const MemoizedMessageItem = memo(MessageItem, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.status === next.message.status
  );
});

// 3. Limpieza de mensajes antiguos
// hooks/useMessageCleanup.ts
export const useMessageCleanup = (chatId: string, maxMessages = 1000) => {
  const { messages, removeOldMessages } = useChatStore();

  useEffect(() => {
    const chatMessages = messages.get(chatId) || [];
    if (chatMessages.length > maxMessages * 1.2) {
      // Mantener solo los últimos maxMessages
      removeOldMessages(chatId, maxMessages);
    }
  }, [messages, chatId, maxMessages]);
};

// 4. Memory monitoring en desarrollo
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    if (performance.memory) {
      const { usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
      const usagePercent = (usedJSHeapSize / jsHeapSizeLimit) * 100;
      if (usagePercent > 80) {
        console.warn(`High memory usage: ${usagePercent.toFixed(1)}%`);
      }
    }
  }, 30000);
}
```

### Métricas de Éxito
- [ ] 60 FPS en scroll con 10k+ mensajes
- [ ] Memoria estable < 500MB
- [ ] Sin lag perceptible en typing
- [ ] Smooth scroll en mobile

---

## 10. PWA y Experiencia Offline Completa

### Problema
- Service Worker configurado pero offline-first incompleto
- Sin sincronización de datos offline
- Sin notificaciones push
- Sin instalación como app nativa

### Impacto
- Usuarios sin conexión no pueden trabajar
- Pérdida de datos si hay desconexión
- Sin engagement via push notifications
- Percepción de app web vs app nativa

### Solución Propuesta

```typescript
// 1. Service Worker mejorado con Workbox
// public/sw.ts
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkFirst } from 'workbox-strategies';

// Precache de assets estáticos
precacheAndRoute(self.__WB_MANIFEST);

// API requests: Network first con fallback a cache
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 10,
    plugins: [{
      cacheWillUpdate: async ({ response }) => {
        // Solo cachear respuestas exitosas
        return response?.status === 200 ? response : null;
      },
    }],
  })
);

// Assets estáticos: Cache first
registerRoute(
  ({ request }) => request.destination === 'image' ||
                   request.destination === 'font' ||
                   request.destination === 'style',
  new CacheFirst({
    cacheName: 'static-assets',
  })
);

// 2. Hook de sincronización offline
// hooks/useOfflineSync.ts
export const useOfflineSync = () => {
  const [pendingActions, setPendingActions] = useState<OfflineAction[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      // Sincronizar acciones pendientes
      for (const action of pendingActions) {
        try {
          await syncAction(action);
          setPendingActions(prev => prev.filter(a => a.id !== action.id));
        } catch (e) {
          console.error('Sync failed:', action, e);
        }
      }
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [pendingActions]);

  const queueAction = useCallback((action: Omit<OfflineAction, 'id'>) => {
    if (isOnline) {
      return syncAction({ ...action, id: crypto.randomUUID() });
    }

    const offlineAction = { ...action, id: crypto.randomUUID() };
    setPendingActions(prev => [...prev, offlineAction]);

    // Guardar en IndexedDB
    saveToOfflineQueue(offlineAction);

    return Promise.resolve();
  }, [isOnline]);

  return { isOnline, pendingActions, queueAction };
};

// 3. Componente de estado de conexión
// components/ui/ConnectionStatus.tsx
export const ConnectionStatus = () => {
  const { isOnline, pendingActions } = useOfflineSync();

  if (isOnline && pendingActions.length === 0) return null;

  return (
    <div className={cn(
      'fixed bottom-4 left-4 px-4 py-2 rounded-full text-sm',
      isOnline ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
    )}>
      {isOnline ? (
        <>
          <Loader2 className="animate-spin inline mr-2 h-4 w-4" />
          Sincronizando {pendingActions.length} cambios...
        </>
      ) : (
        <>
          <WifiOff className="inline mr-2 h-4 w-4" />
          Sin conexión
        </>
      )}
    </div>
  );
};

// 4. Manifest mejorado
// public/manifest.json
{
  "name": "ILIAGPT",
  "short_name": "ILIAGPT",
  "description": "Asistente de IA inteligente",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3b82f6",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "screenshots": [
    { "src": "/screenshots/chat.png", "sizes": "1280x720", "type": "image/png" }
  ],
  "categories": ["productivity", "utilities"],
  "shortcuts": [
    {
      "name": "Nuevo Chat",
      "url": "/chat/new",
      "icons": [{ "src": "/icons/new-chat.png", "sizes": "96x96" }]
    }
  ]
}
```

### Métricas de Éxito
- [ ] App instalable como PWA
- [ ] Funcionamiento offline básico
- [ ] Sincronización automática al reconectar
- [ ] Lighthouse PWA score > 90

---

## Resumen de Prioridades

| # | Mejora | Impacto | Esfuerzo | Prioridad |
|---|--------|---------|----------|-----------|
| 1 | Refactorización componentes | 🔴 Alto | 🔴 Alto | **P0** |
| 2 | Testing del cliente | 🔴 Alto | 🟡 Medio | **P0** |
| 3 | Accesibilidad | 🔴 Alto | 🟡 Medio | **P0** |
| 4 | Bundle optimization | 🟡 Medio | 🟡 Medio | **P1** |
| 5 | Error handling | 🟡 Medio | 🟢 Bajo | **P1** |
| 6 | Validación formularios | 🟡 Medio | 🟢 Bajo | **P1** |
| 7 | Skeleton loading | 🟢 Bajo | 🟢 Bajo | **P2** |
| 8 | i18n consistente | 🟡 Medio | 🟡 Medio | **P2** |
| 9 | Listas virtualizadas | 🟡 Medio | 🟡 Medio | **P2** |
| 10 | PWA completo | 🟢 Bajo | 🟡 Medio | **P3** |

---

## Plan de Implementación Sugerido

### Sprint 1 (2 semanas)
- [ ] Refactorizar `chat-interface.tsx`
- [ ] Configurar Vitest + React Testing Library
- [ ] Auditoría de accesibilidad con axe

### Sprint 2 (2 semanas)
- [ ] Tests para stores de Zustand
- [ ] Remediación de accesibilidad
- [ ] Bundle analysis en CI

### Sprint 3 (2 semanas)
- [ ] Lazy loading de editores pesados
- [ ] Sistema de errores unificado
- [ ] Validación con Zod en todos los forms

### Sprint 4 (2 semanas)
- [ ] Skeleton screens
- [ ] Consolidar i18n
- [ ] Optimizar listas virtualizadas

### Sprint 5 (1 semana)
- [ ] PWA improvements
- [ ] Documentación de componentes

---

*Documento generado automáticamente basado en análisis de código.*
