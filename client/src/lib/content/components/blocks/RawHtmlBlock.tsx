/**
 * RawHtmlBlock Component
 * 
 * Renders sanitized HTML.
 */

import React from 'react';
import type { RawHtmlBlock as RawHtmlBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme } from '../../renderers/block-renderer';
import { sanitizeHtml } from '../../parsers/content-parser';

interface Props {
    block: RawHtmlBlockType;
    context: RenderContext;
}

export default function RawHtmlBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const { html, sanitized } = block;

    const safeHtml = sanitized ? html : sanitizeHtml(html);

    return (
        <div
            className="my-4 prose prose-sm max-w-none"
            style={{ color: theme.colors.foreground }}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
    );
}
