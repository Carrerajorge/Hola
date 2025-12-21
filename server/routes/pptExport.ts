import { Router } from 'express';
import pptxgen from 'pptxgenjs';

export const pptExportRouter = Router();

interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface DeltaOp {
  insert: string;
  attributes?: Record<string, any>;
}

interface Delta {
  ops: DeltaOp[];
}

interface BaseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
}

interface TextElement extends BaseElement {
  type: 'text';
  delta: Delta;
  defaultTextStyle: TextStyle;
}

interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: 'rect' | 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
}

interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
}

interface ChartElement extends BaseElement {
  type: 'chart';
  svg?: string;
  src?: string;
}

type ElementAny = TextElement | ShapeElement | ImageElement | ChartElement;

interface Slide {
  id: string;
  size: { w: number; h: number };
  background: { color: string };
  elements: ElementAny[];
}

interface Deck {
  title: string;
  slides: Slide[];
}

function pxToIn(px: number): number {
  return px / 96;
}

function normalizeHex(hex: string): string {
  const h = String(hex || '').trim();
  if (!h) return '000000';
  return h.replace('#', '').toUpperCase();
}

function deltaToPlainText(delta: Delta): string {
  return delta.ops.map(op => op.insert).join('');
}

function svgToDataUri(svg: string): string {
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

pptExportRouter.post('/export', async (req, res) => {
  try {
    const deck: Deck = req.body;

    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = deck.title || 'Presentation';

    for (const s of deck.slides ?? []) {
      const slide = pptx.addSlide();

      if (s.background?.color) {
        slide.background = { color: normalizeHex(s.background.color) };
      }

      const elements = [...(s.elements ?? [])].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

      for (const el of elements) {
        const x = pxToIn(el.x ?? 0);
        const y = pxToIn(el.y ?? 0);
        const w = pxToIn(el.w ?? 100);
        const h = pxToIn(el.h ?? 40);

        if (el.type === 'text') {
          const textEl = el as TextElement;
          const plain = deltaToPlainText(textEl.delta);
          const style = textEl.defaultTextStyle;

          slide.addText(plain, {
            x,
            y,
            w,
            h,
            fontFace: style?.fontFamily ?? 'Arial',
            fontSize: style?.fontSize ?? 18,
            color: normalizeHex(style?.color ?? '#111111'),
            bold: !!style?.bold,
            italic: !!style?.italic,
            underline: style?.underline ? { style: 'sng' } : undefined,
            rotate: el.rotation ?? 0
          });
          continue;
        }

        if (el.type === 'shape') {
          const shapeEl = el as ShapeElement;
          const shapeType = shapeEl.shapeType === 'ellipse' ? 'ellipse' : 'rect';

          slide.addShape(shapeType, {
            x,
            y,
            w,
            h,
            fill: { color: normalizeHex(shapeEl.fill ?? '#FFFFFF') },
            line: { 
              color: normalizeHex(shapeEl.stroke ?? '#000000'), 
              width: shapeEl.strokeWidth ?? 1 
            },
            rotate: el.rotation ?? 0
          });
          continue;
        }

        if (el.type === 'image') {
          const imgEl = el as ImageElement;
          if (imgEl.src) {
            slide.addImage({
              data: imgEl.src,
              x,
              y,
              w,
              h,
              rotate: el.rotation ?? 0
            });
          }
          continue;
        }

        if (el.type === 'chart') {
          const chartEl = el as ChartElement;
          if (chartEl.svg) {
            const uri = svgToDataUri(chartEl.svg);
            slide.addImage({ data: uri, x, y, w, h, rotate: el.rotation ?? 0 });
          } else if (chartEl.src) {
            slide.addImage({ data: chartEl.src, x, y, w, h, rotate: el.rotation ?? 0 });
          }
          continue;
        }
      }
    }

    const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${deck.title || 'presentation'}.pptx"`);
    res.send(buffer);
  } catch (error: any) {
    console.error('PPTX export error:', error);
    res.status(500).json({ error: error.message || 'Failed to export PPTX' });
  }
});
