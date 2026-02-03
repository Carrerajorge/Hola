import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

interface SearchModalProps {
    isOpen?: boolean;
    onClose?: () => void;
}

interface SearchResult {
    id: string;
    content: string;
    role: string;
    createdAt?: string;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const trimmedQuery = useMemo(() => query.trim(), [query]);

    useEffect(() => {
        if (!trimmedQuery) {
            setResults([]);
            setError(null);
            return;
        }

        const handler = setTimeout(async () => {
            try {
                setIsLoading(true);
                setError(null);
                const response = await fetch(`/api/chats/search?q=${encodeURIComponent(trimmedQuery)}`, {
                    credentials: 'include'
                });
                if (!response.ok) {
                    throw new Error('No se pudo completar la búsqueda.');
                }
                const data = await response.json();
                setResults(Array.isArray(data) ? data : []);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Error de búsqueda');
                setResults([]);
            } finally {
                setIsLoading(false);
            }
        }, 300);

        return () => clearTimeout(handler);
    }, [trimmedQuery]);

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-background/80 backdrop-blur-sm">
            <div className="w-full max-w-2xl bg-card rounded-lg shadow-lg border">
                <div className="flex items-center gap-3 p-4 border-b">
                    <Search className="w-5 h-5 text-muted-foreground" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar conversaciones, archivos, GPTs..."
                        className="flex-1 bg-transparent outline-none text-lg"
                        autoFocus
                    />
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-4 space-y-3">
                    {!trimmedQuery && (
                        <p className="text-center text-muted-foreground">Escribe para buscar</p>
                    )}
                    {isLoading && (
                        <p className="text-center text-muted-foreground">Buscando "{trimmedQuery}"...</p>
                    )}
                    {error && (
                        <p className="text-center text-sm text-destructive">{error}</p>
                    )}
                    {!isLoading && !error && trimmedQuery && results.length === 0 && (
                        <p className="text-center text-muted-foreground">No se encontraron resultados.</p>
                    )}
                    {results.length > 0 && (
                        <div className="space-y-2 max-h-96 overflow-auto">
                            {results.map((result) => (
                                <div key={result.id} className="border rounded-md p-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs uppercase text-muted-foreground">{result.role}</span>
                                        {result.createdAt && (
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(result.createdAt).toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-2 text-sm line-clamp-3">{result.content}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
