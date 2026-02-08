import React, { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  active: boolean;
}

const COLORS = [
  '#8B5CF6', // Purple
  '#06B6D4', // Cyan
  '#EC4899', // Pink
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#6366F1', // Indigo
];

const BASE_FPS = 60;
const LIFE_DECAY = 0.003 * BASE_FPS;  // per-second
const MAX_DT = 1 / 30;
const POOL_SIZE = 80;
const SPAWN_CHANCE_PER_S = 0.15 * BASE_FPS; // probability normalised to per-second

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Particle pool
// ---------------------------------------------------------------------------

function createPool(n: number): Particle[] {
  const pool: Particle[] = [];
  for (let i = 0; i < n; i++) {
    pool.push({ x: 0, y: 0, vx: 0, vy: 0, size: 0, color: '', alpha: 0, life: 0, active: false });
  }
  return pool;
}

function acquire(pool: Particle[]): Particle | null {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) { pool[i].active = true; return pool[i]; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WelcomeAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initedRef = useRef(false);

  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;

    if (prefersReducedMotion) return; // skip animation entirely

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // ---- Sizing ----
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ---- Pool & particles ----
    const pool = createPool(POOL_SIZE);

    const initParticle = (p: Particle, y?: number) => {
      const w = canvas.offsetWidth;
      p.x = Math.random() * w;
      p.y = y !== undefined ? y : -10;
      p.vx = ((Math.random() - 0.5) * 2) * BASE_FPS;
      p.vy = (Math.random() * 3 + 1) * BASE_FPS;
      p.size = Math.random() * 4 + 2;
      p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      p.alpha = Math.random() * 0.6 + 0.4;
      p.life = 1;
    };

    // Seed initial particles spread across viewport
    for (let i = 0; i < 50; i++) {
      const p = acquire(pool);
      if (!p) break;
      initParticle(p, Math.random() * canvas.offsetHeight);
    }

    // ---- Visibility ----
    let paused = false;
    let lastFrameTime = 0;

    const handleVisibility = () => {
      if (document.hidden) {
        paused = true;
      } else {
        paused = false;
        lastFrameTime = 0;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ---- Animation loop ----
    let animId = 0;

    const animate = (now: number) => {
      if (paused) { animId = requestAnimationFrame(animate); return; }

      if (lastFrameTime === 0) lastFrameTime = now;
      const dt = Math.min((now - lastFrameTime) / 1000, MAX_DT);
      lastFrameTime = now;

      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      // Spawn new particles (probability scaled by dt)
      if (Math.random() < SPAWN_CHANCE_PER_S * dt) {
        const p = acquire(pool);
        if (p) initParticle(p);
      }

      // Update & draw
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= LIFE_DECAY * dt;
        p.alpha = p.life * 0.8;

        if (p.life <= 0 || p.y > h + 20) {
          p.active = false;
          continue;
        }

        // Glow
        ctx.save();
        ctx.globalAlpha = p.alpha;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Core
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
      {/* Particle canvas */}
      {!prefersReducedMotion && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ opacity: 0.7 }}
        />
      )}

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-6 px-4">
        {/* Animated Logo/Icon */}
        <div className="relative">
          <div className="absolute inset-0 animate-ping opacity-20">
            <div className="w-24 h-24 rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500" />
          </div>
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-r from-purple-600 via-pink-500 to-cyan-400 flex items-center justify-center shadow-2xl shadow-purple-500/30 animate-pulse">
            <Sparkles className="w-12 h-12 text-white" />
          </div>
        </div>

        {/* Welcome Text */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-bold">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent animate-gradient">
              ¡Bienvenido a ILIAGPT!
            </span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            Tu asistente de IA más inteligente está listo para ayudarte
          </p>
        </div>

        {/* Feature Pills */}
        <div className="flex flex-wrap gap-3 justify-center max-w-lg">
          {['Crear imágenes', 'Investigar', 'Programar', 'Analizar datos', 'Escribir documentos'].map((feature, idx) => (
            <span
              key={feature}
              className="px-4 py-2 rounded-full text-sm font-medium bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 text-purple-300 hover:border-purple-500/40 transition-all duration-300"
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              {feature}
            </span>
          ))}
        </div>

        {/* Call to Action */}
        <p className="text-muted-foreground/80 text-sm mt-4">
          Escribe tu primera pregunta para comenzar
        </p>
      </div>

      {/* CSS for gradient animation */}
      <style>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 3s ease infinite;
        }
      `}</style>
    </div>
  );
}
