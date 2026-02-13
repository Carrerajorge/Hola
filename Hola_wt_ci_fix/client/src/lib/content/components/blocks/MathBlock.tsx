/**
 * MathBlock Pro Component
 * 
 * Renders LaTeX with KaTeX for fast, beautiful math.
 */

import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { MathBlock as MathBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { Copy, Check } from 'lucide-react';

interface Props {
    block: MathBlockType;
    context: RenderContext;
}

export default function MathBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const [copied, setCopied] = React.useState(false);
    const { expression, displayMode = true } = block;

    const renderedMath = useMemo(() => {
        try {
            return katex.renderToString(expression, {
                displayMode,
                throwOnError: false,
                strict: false,
                trust: true,
                macros: {
                    '\\R': '\\mathbb{R}',
                    '\\N': '\\mathbb{N}',
                    '\\Z': '\\mathbb{Z}',
                    '\\Q': '\\mathbb{Q}',
                    '\\C': '\\mathbb{C}',
                },
            });
        } catch (e) {
            return `<span class="text-red-500">Error: ${expression}</span>`;
        }
    }, [expression, displayMode]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(expression);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (displayMode) {
        return (
            <div
                className="my-6 relative group"
                style={{ backgroundColor: theme.mode === 'dark' ? '#1e293b' : '#f8fafc' }}
            >
                <div
                    className="py-6 px-8 rounded-xl overflow-x-auto text-center"
                    dangerouslySetInnerHTML={{ __html: renderedMath }}
                />

                {/* Copy LaTeX button */}
                <button
                    onClick={handleCopy}
                    className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 hover:bg-black/30"
                    title="Copiar LaTeX"
                >
                    {copied ? (
                        <Check size={14} className="text-green-400" />
                    ) : (
                        <Copy size={14} style={{ color: theme.colors.mutedForeground }} />
                    )}
                </button>
            </div>
        );
    }

    // Inline math
    return (
        <span
            className="mx-1 inline-block"
            dangerouslySetInnerHTML={{ __html: renderedMath }}
        />
    );
}
