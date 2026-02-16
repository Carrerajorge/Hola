/**
 * EmbedBlock Component
 * 
 * Renders embedded content (YouTube, Twitter, etc.).
 */

import React from 'react';
import type { EmbedBlock as EmbedBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { ExternalLink, Play } from 'lucide-react';

interface Props {
    block: EmbedBlockType;
    context: RenderContext;
}

const getEmbedUrl = (provider: string, url: string): string => {
    switch (provider) {
        case 'youtube': {
            const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
            return match ? `https://www.youtube.com/embed/${match[1]}` : url;
        }
        case 'vimeo': {
            const match = url.match(/vimeo\.com\/(\d+)/);
            return match ? `https://player.vimeo.com/video/${match[1]}` : url;
        }
        case 'twitter': {
            return url; // Twitter requires API, show link instead
        }
        case 'spotify': {
            return url.replace('open.spotify.com', 'open.spotify.com/embed');
        }
        default:
            return url;
    }
};

export default function EmbedBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { provider, url, embedUrl, width, height, aspectRatio = '16/9' } = block;

    const finalEmbedUrl = embedUrl || getEmbedUrl(provider, url);

    // For Twitter, just show a link card
    if (provider === 'twitter') {
        return (
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="my-4 block p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                style={{ borderColor: theme.colors.border }}
            >
                <div className="flex items-center gap-3">
                    <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: '#1DA1F2' }}
                    >
                        <span className="text-white font-bold">𝕏</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p
                            className="font-medium"
                            style={{ color: theme.colors.foreground }}
                        >
                            Ver en Twitter
                        </p>
                        <p
                            className="text-sm truncate"
                            style={{ color: theme.colors.mutedForeground }}
                        >
                            {url}
                        </p>
                    </div>
                    <ExternalLink size={18} style={{ color: theme.colors.mutedForeground }} />
                </div>
            </a>
        );
    }

    return (
        <div
            className="my-4 rounded-lg overflow-hidden"
            style={{
                aspectRatio,
                maxWidth: width || '100%',
            }}
        >
            <iframe
                src={finalEmbedUrl}
                width="100%"
                height="100%"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
                style={{
                    height: height || '100%',
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: theme.borderRadius.lg,
                }}
            />
        </div>
    );
}
