/**
 * PixiJS Rendering Engine
 * High-performance 2D WebGL renderer
 */

import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import type { PixiSceneConfig } from '../types';

export interface PixiEngineProps {
  config?: PixiSceneConfig;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
}

export interface PixiEngineRef {
  getApp: () => any | null;
  takeScreenshot: () => string | null;
  destroy: () => void;
}

export const PixiEngine = forwardRef<PixiEngineRef, PixiEngineProps>(
  function PixiEngine({ config, width = 800, height = 600, className, style, onReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<any>(null);
    const [loaded, setLoaded] = useState(false);

    useImperativeHandle(ref, () => ({
      getApp: () => appRef.current,
      takeScreenshot: () => {
        if (appRef.current?.canvas) {
          return (appRef.current.canvas as HTMLCanvasElement).toDataURL('image/png');
        }
        return null;
      },
      destroy: () => {
        if (appRef.current) {
          appRef.current.destroy(true);
          appRef.current = null;
        }
      },
    }));

    const initPixi = useCallback(async () => {
      if (!containerRef.current) return;

      try {
        const PIXI = await import('pixi.js');

        // Clean up previous instance
        if (appRef.current) {
          appRef.current.destroy(true);
        }

        const app = new PIXI.Application();
        await app.init({
          width: config?.width || width,
          height: config?.height || height,
          backgroundColor: config?.background || 0x1a1a2e,
          antialias: config?.antialias ?? true,
          resolution: config?.resolution || window.devicePixelRatio || 1,
          autoDensity: true,
        });

        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(app.canvas as HTMLCanvasElement);
        appRef.current = app;

        // Create demo scene if no sprites configured
        if (!config?.sprites || config.sprites.length === 0) {
          createDemoScene(PIXI, app);
        }

        setLoaded(true);
        onReady?.();
      } catch (error) {
        console.error('PixiJS initialization error:', error);
      }
    }, [config, width, height, onReady]);

    useEffect(() => {
      initPixi();
      return () => {
        if (appRef.current) {
          appRef.current.destroy(true);
          appRef.current = null;
        }
      };
    }, [initPixi]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          width,
          height,
          overflow: 'hidden',
          borderRadius: '8px',
          position: 'relative',
          ...style,
        }}
        data-testid="pixi-engine"
      />
    );
  }
);

/**
 * Creates a demo particle scene for PixiJS
 */
function createDemoScene(PIXI: any, app: any) {
  const particleCount = 200;
  const container = new PIXI.Container();
  app.stage.addChild(container);

  const particles: any[] = [];

  for (let i = 0; i < particleCount; i++) {
    const graphics = new PIXI.Graphics();
    const size = Math.random() * 4 + 1;
    const colors = [0x6366f1, 0xec4899, 0x06b6d4, 0x10b981, 0xf59e0b];
    const color = colors[Math.floor(Math.random() * colors.length)];

    graphics.circle(0, 0, size);
    graphics.fill({ color, alpha: Math.random() * 0.5 + 0.5 });

    graphics.x = Math.random() * app.screen.width;
    graphics.y = Math.random() * app.screen.height;

    const particle = {
      sprite: graphics,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      baseAlpha: Math.random() * 0.5 + 0.5,
      phase: Math.random() * Math.PI * 2,
    };

    particles.push(particle);
    container.addChild(graphics);
  }

  // Connection lines container
  const linesGraphics = new PIXI.Graphics();
  container.addChild(linesGraphics);

  // Animation loop
  app.ticker.add((ticker: any) => {
    const time = Date.now() * 0.001;

    for (const p of particles) {
      p.sprite.x += p.vx;
      p.sprite.y += p.vy;
      p.sprite.alpha = p.baseAlpha * (0.7 + 0.3 * Math.sin(time + p.phase));

      // Wrap around
      if (p.sprite.x < 0) p.sprite.x = app.screen.width;
      if (p.sprite.x > app.screen.width) p.sprite.x = 0;
      if (p.sprite.y < 0) p.sprite.y = app.screen.height;
      if (p.sprite.y > app.screen.height) p.sprite.y = 0;
    }

    // Draw connections
    linesGraphics.clear();
    const connectionDistance = 100;

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].sprite.x - particles[j].sprite.x;
        const dy = particles[i].sprite.y - particles[j].sprite.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < connectionDistance) {
          const alpha = (1 - dist / connectionDistance) * 0.3;
          linesGraphics.moveTo(particles[i].sprite.x, particles[i].sprite.y);
          linesGraphics.lineTo(particles[j].sprite.x, particles[j].sprite.y);
          linesGraphics.stroke({ color: 0x6366f1, alpha, width: 1 });
        }
      }
    }
  });

  // Title text
  const titleStyle = new PIXI.TextStyle({
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 20,
    fontWeight: 'bold',
    fill: '#ffffff',
    dropShadow: {
      color: '#000000',
      blur: 4,
      distance: 2,
    },
  });

  const title = new PIXI.Text({ text: 'PixiJS Particle Network', style: titleStyle });
  title.anchor.set(0.5);
  title.x = app.screen.width / 2;
  title.y = 30;
  app.stage.addChild(title);
}
