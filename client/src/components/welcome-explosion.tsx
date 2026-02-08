import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, Zap, Brain, Rocket, Stars } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
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
  type: 'spark' | 'confetti' | 'star';
  rotation: number;
  rotationSpeed: number;
  active: boolean; // pool flag
}

interface Firework {
  x: number;
  y: number;
  targetY: number;
  speed: number;
  color: string;
  exploded: boolean;
  particles: Particle[];
}

// ---------------------------------------------------------------------------
// Constants — physics normalised to per-second values (target 60 fps)
// ---------------------------------------------------------------------------

const COLORS = [
  '#F8D34B', // Amber
  '#F06595', // Rose
  '#5CC8FF', // Sky
  '#6EE7B7', // Mint
  '#A78BFA', // Violet
  '#F97316', // Warm Orange
];

const BASE_FPS = 60;
const GRAVITY       = 0.06 * BASE_FPS;            // ≈ 3.6 px/s²
const DAMPING_PER_S = Math.pow(0.985, BASE_FPS);  // per-second damping factor
const LIFE_DECAY    = 0.018 * BASE_FPS;            // ≈ 1.08 /s
const RISE_SPEED    = 11 * BASE_FPS;               // ≈ 660 px/s
const CONFETTI_G    = 0.015 * BASE_FPS;            // confetti gravity

const MAX_DT        = 1 / 30;  // cap dt to avoid spiral-of-death after tab resume
const ANIMATION_DURATION_MS = 5500;

// Reduced-motion: skip canvas entirely, rely on CSS transitions only
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Particle object pool — eliminates GC pressure from create/destroy churn
// ---------------------------------------------------------------------------

function createPool(capacity: number): Particle[] {
  const pool: Particle[] = [];
  for (let i = 0; i < capacity; i++) {
    pool.push({
      x: 0, y: 0, vx: 0, vy: 0,
      size: 0, color: '', alpha: 0, life: 0,
      type: 'spark', rotation: 0, rotationSpeed: 0,
      active: false,
    });
  }
  return pool;
}

function acquireParticle(pool: Particle[]): Particle | null {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) {
      pool[i].active = true;
      return pool[i];
    }
  }
  return null; // pool exhausted — gracefully skip
}

function releaseParticle(p: Particle) {
  p.active = false;
}

// ---------------------------------------------------------------------------
// Device capability detection
// ---------------------------------------------------------------------------

function detectPerformanceTier(): 'high' | 'medium' | 'low' {
  if (typeof navigator === 'undefined') return 'medium';

  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory as number | undefined;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile && (cores <= 4 || (memory !== undefined && memory <= 2))) return 'low';
  if (cores <= 2 || (memory !== undefined && memory <= 2)) return 'low';
  if (cores >= 8 && (memory === undefined || memory >= 8)) return 'high';
  return 'medium';
}

const TIER = detectPerformanceTier();

// Scale particle budgets by device tier
const PARTICLE_BUDGET = TIER === 'high' ? 600 : TIER === 'medium' ? 350 : 180;
const FIREWORK_PARTICLES = TIER === 'high' ? { min: 35, range: 15 } :
                           TIER === 'medium' ? { min: 25, range: 10 } :
                           { min: 15, range: 8 };
const INITIAL_FIREWORKS = TIER === 'low' ? 3 : 5;
const WAVE2_COUNT = TIER === 'low' ? 2 : 3;
const WAVE3_COUNT = TIER === 'low' ? 1 : 2;
const CONFETTI_INTERVAL_MS = TIER === 'low' ? 350 : 200;

// ---------------------------------------------------------------------------
// WelcomeExplosion Component
// ---------------------------------------------------------------------------

export function WelcomeExplosion({ onComplete }: { onComplete?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'explosion' | 'welcome' | 'features' | 'ready'>('explosion');
  const [showContent, setShowContent] = useState(false);

  // Refs to read inside closures without triggering re-initialisation
  const phaseRef = useRef(phase);
  const onCompleteRef = useRef(onComplete);
  const initedRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    // Guard against double-initialisation (React 18 StrictMode)
    if (initedRef.current) return;
    initedRef.current = true;

    // If user prefers reduced motion, skip canvas animation entirely
    if (prefersReducedMotion) {
      setShowContent(true);
      setPhase('welcome');
      const t = setTimeout(() => {
        setPhase('features');
        setTimeout(() => {
          setPhase('ready');
          setTimeout(() => onCompleteRef.current?.(), 1600);
        }, 1200);
      }, 800);
      return () => clearTimeout(t);
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // ---- Canvas sizing ----
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ---- Object pool ----
    const pool = createPool(PARTICLE_BUDGET);

    // ---- Fireworks storage ----
    const fireworks: Firework[] = [];
    const confetti: Particle[] = [];

    // ---- Visibility state ----
    let paused = false;
    let pausedAt = 0;
    let totalPausedTime = 0;

    const handleVisibility = () => {
      if (document.hidden) {
        paused = true;
        pausedAt = performance.now();
      } else {
        if (paused) {
          totalPausedTime += performance.now() - pausedAt;
          paused = false;
          lastFrameTime = 0; // reset dt on resume to avoid huge jump
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ---- Factory helpers ----
    const createFirework = (): Firework => {
      const h = window.innerHeight;
      return {
        x: Math.random() * window.innerWidth,
        y: h + 10,
        targetY: Math.random() * (h * 0.4) + h * 0.1,
        speed: RISE_SPEED * (0.85 + Math.random() * 0.3),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        exploded: false,
        particles: [],
      };
    };

    const initParticle = (p: Particle, x: number, y: number, color: string, type: Particle['type'], vx: number, vy: number, size: number): Particle => {
      p.x = x; p.y = y; p.color = color; p.type = type;
      p.vx = vx; p.vy = vy; p.size = size;
      p.alpha = 1; p.life = 1;
      p.rotation = Math.random() * Math.PI * 2;
      p.rotationSpeed = (Math.random() - 0.5) * 0.2 * BASE_FPS;
      return p;
    };

    const explodeFirework = (fw: Firework) => {
      const count = FIREWORK_PARTICLES.min + Math.floor(Math.random() * FIREWORK_PARTICLES.range);
      for (let i = 0; i < count; i++) {
        const p = acquireParticle(pool);
        if (!p) break; // budget exhausted
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = (2 + Math.random() * 4) * BASE_FPS;
        const color = Math.random() > 0.3 ? fw.color : COLORS[Math.floor(Math.random() * COLORS.length)];
        initParticle(p, fw.x, fw.y, color, Math.random() > 0.75 ? 'star' : 'spark',
          Math.cos(angle) * speed, Math.sin(angle) * speed,
          1.5 + Math.random() * 2.5);
        fw.particles.push(p);
      }
    };

    const spawnConfetti = () => {
      const p = acquireParticle(pool);
      if (!p) return;
      initParticle(p,
        Math.random() * window.innerWidth, -20,
        COLORS[Math.floor(Math.random() * COLORS.length)], 'confetti',
        (Math.random() - 0.5) * 2.5 * BASE_FPS,
        (1.5 + Math.random() * 3) * BASE_FPS,
        5 + Math.random() * 6);
      confetti.push(p);
    };

    // ---- Firework scheduling ----
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const scheduleTimeout = (fn: () => void, delay: number) => {
      timeouts.push(setTimeout(fn, delay));
    };

    // Wave 1 — staggered start after 100 ms for canvas to settle
    for (let i = 0; i < INITIAL_FIREWORKS; i++) {
      scheduleTimeout(() => fireworks.push(createFirework()), 100 + i * 200);
    }
    // Wave 2
    scheduleTimeout(() => {
      for (let i = 0; i < WAVE2_COUNT; i++) {
        scheduleTimeout(() => fireworks.push(createFirework()), i * 280);
      }
    }, 900);
    // Wave 3
    scheduleTimeout(() => {
      for (let i = 0; i < WAVE3_COUNT; i++) {
        scheduleTimeout(() => fireworks.push(createFirework()), i * 300);
      }
    }, 1500);

    // Confetti spawner — reads phaseRef to avoid stale closures
    const confettiInterval = setInterval(() => {
      if (phaseRef.current === 'explosion') {
        spawnConfetti();
      }
    }, CONFETTI_INTERVAL_MS);

    // Phase transitions
    scheduleTimeout(() => setShowContent(true), 600);
    scheduleTimeout(() => setPhase('welcome'), 1000);
    scheduleTimeout(() => setPhase('features'), 2100);
    scheduleTimeout(() => setPhase('ready'), 3400);
    scheduleTimeout(() => onCompleteRef.current?.(), 5000);

    // ---- Draw helpers — minimise canvas state changes ----
    const drawStar = (x: number, y: number, size: number, rotation: number, color: string, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const inner = a + Math.PI / 5;
        if (i === 0) ctx.moveTo(Math.cos(a) * size, Math.sin(a) * size);
        else ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
        ctx.lineTo(Math.cos(inner) * size * 0.4, Math.sin(inner) * size * 0.4);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawGlow = (x: number, y: number, size: number, color: string, alpha: number) => {
      const r = size * 2.2;
      // Glow halo
      ctx.save();
      ctx.globalAlpha = alpha * 0.78;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Core
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // ---- Main animation loop ----
    let lastFrameTime = 0;
    let animId = 0;
    const startTimestamp = performance.now();

    const animate = (now: number) => {
      if (paused) {
        animId = requestAnimationFrame(animate);
        return;
      }

      // Delta time (seconds), capped
      if (lastFrameTime === 0) lastFrameTime = now;
      const dt = Math.min((now - lastFrameTime) / 1000, MAX_DT);
      lastFrameTime = now;

      const elapsed = now - startTimestamp - totalPausedTime;
      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx.clearRect(0, 0, w, h);

      // --- Update & draw fireworks ---
      let fwIdx = fireworks.length;
      while (fwIdx--) {
        const fw = fireworks[fwIdx];

        if (!fw.exploded) {
          fw.y -= fw.speed * dt;

          // Rising trail
          ctx.fillStyle = fw.color;
          ctx.beginPath();
          ctx.arc(fw.x, fw.y, 3, 0, Math.PI * 2);
          ctx.fill();

          // Sparkle trail (batched under same globalAlpha)
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = fw.color;
          for (let t = 0; t < 3; t++) {
            ctx.beginPath();
            ctx.arc(fw.x + (Math.random() - 0.5) * 5, fw.y + t * 8, 1.6 - t * 0.45, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          if (fw.y <= fw.targetY) {
            fw.exploded = true;
            explodeFirework(fw);
          }
          continue;
        }

        // Update explosion particles
        let pIdx = fw.particles.length;
        while (pIdx--) {
          const p = fw.particles[pIdx];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += GRAVITY * dt;
          p.vx *= Math.pow(DAMPING_PER_S, dt);
          p.life -= LIFE_DECAY * dt;
          p.alpha = Math.max(0, p.life);
          p.rotation += p.rotationSpeed * dt;

          if (p.life <= 0) {
            releaseParticle(p);
            fw.particles[pIdx] = fw.particles[fw.particles.length - 1];
            fw.particles.pop();
            continue;
          }

          if (p.type === 'star') drawStar(p.x, p.y, p.size, p.rotation, p.color, p.alpha);
          else drawGlow(p.x, p.y, p.size, p.color, p.alpha);
        }

        // Remove exhausted firework
        if (fw.exploded && fw.particles.length === 0) {
          fireworks[fwIdx] = fireworks[fireworks.length - 1];
          fireworks.pop();
        }
      }

      // --- Update & draw confetti ---
      let cIdx = confetti.length;
      while (cIdx--) {
        const c = confetti[cIdx];
        c.x += (c.vx + Math.sin(c.y * 0.02) * 0.35 * BASE_FPS) * dt;
        c.y += c.vy * dt;
        c.rotation += c.rotationSpeed * dt;
        c.vy += CONFETTI_G * dt;

        if (c.y > h + 20) {
          releaseParticle(c);
          confetti[cIdx] = confetti[confetti.length - 1];
          confetti.pop();
          continue;
        }

        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rotation);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
        ctx.restore();
      }

      if (elapsed < ANIMATION_DURATION_MS) {
        animId = requestAnimationFrame(animate);
      }
    };

    animId = requestAnimationFrame(animate);

    // ---- Cleanup ----
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', resizeCanvas);
      clearInterval(confettiInterval);
      timeouts.forEach(clearTimeout);
      cancelAnimationFrame(animId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden text-white">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(900px circle at 20% 15%, rgba(92,200,255,0.18), transparent 45%), radial-gradient(900px circle at 80% 20%, rgba(167,139,250,0.18), transparent 40%), radial-gradient(900px circle at 50% 85%, rgba(240,101,149,0.16), transparent 45%), linear-gradient(180deg, #0b0d12 0%, #0b0f18 60%, #0a0b10 100%)',
        }}
      />

      {/* Particle canvas — hidden when prefers-reduced-motion */}
      {!prefersReducedMotion && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      )}

      {/* Content Overlay */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center px-6 transition-all duration-1000 ${showContent ? 'opacity-100' : 'opacity-0'}`}
        style={{ fontFamily: '"Space Grotesk", "Geist", "Inter", sans-serif' }}
      >
        {/* Logo */}
        <div className={`relative mb-8 transition-all duration-700 ${phase !== 'explosion' ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
          <div className="relative flex items-center justify-center">
            <div className="absolute w-32 h-32 rounded-full bg-white/5 blur-2xl" />
            <div className="w-24 h-24 rounded-full border border-white/20 bg-white/5 flex items-center justify-center shadow-[0_0_40px_rgba(92,200,255,0.25)]">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center">
                <Sparkles className="w-9 h-9 text-white/90" />
              </div>
            </div>
          </div>
        </div>

        {/* Welcome text */}
        <div className={`text-center space-y-4 transition-all duration-700 ${phase !== 'explosion' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <p className="text-xs uppercase tracking-[0.4em] text-white/60">Bienvenido</p>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight">
            <span className="text-white/90">ILIAGPT</span>
          </h1>
          <p className={`text-base md:text-lg text-white/70 transition-all duration-500 delay-300 ${phase === 'welcome' || phase === 'features' || phase === 'ready' ? 'opacity-100' : 'opacity-0'}`}>
            Un asistente de IA premium para trabajo serio y creativo.
          </p>
        </div>

        {/* Feature cards */}
        <div className={`mt-10 flex flex-wrap justify-center gap-3 max-w-2xl transition-all duration-700 ${phase === 'features' || phase === 'ready' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          {[
            { icon: Brain, label: 'IA Confiable', color: 'from-violet-400/30 to-purple-500/10' },
            { icon: Zap, label: 'Respuesta Ágil', color: 'from-sky-400/30 to-cyan-500/10' },
            { icon: Rocket, label: 'Flujo Continuo', color: 'from-emerald-400/30 to-teal-500/10' },
            { icon: Stars, label: 'Detalles Premium', color: 'from-rose-400/30 to-pink-500/10' },
          ].map((feature, idx) => (
            <div
              key={feature.label}
              className="flex items-center gap-3 px-5 py-3 rounded-full bg-white/5 backdrop-blur border border-white/10 transform transition-all duration-500"
              style={{
                transitionDelay: `${idx * 100}ms`,
                animation: phase === 'features' || phase === 'ready' ? `fade-up 0.6s ease-out ${idx * 120}ms both` : 'none'
              }}
            >
              <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${feature.color} flex items-center justify-center border border-white/10`}>
                <feature.icon className="w-4 h-4 text-white/80" />
              </div>
              <span className="text-white/85 text-sm font-medium">{feature.label}</span>
            </div>
          ))}
        </div>

        {/* CTA button */}
        <div className={`mt-10 transition-all duration-700 ${phase === 'ready' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <button
            onClick={onComplete}
            className="group relative px-7 py-3 rounded-full border border-white/15 bg-white/5 text-white/90 text-sm uppercase tracking-[0.25em] transition-all duration-300 hover:border-white/30"
          >
            <span className="absolute inset-0 rounded-full bg-gradient-to-r from-white/10 via-white/30 to-white/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <span className="relative">Comenzar</span>
          </button>
        </div>
      </div>

      {/* Scoped keyframes */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 2s ease infinite;
        }
        @keyframes fade-up {
          0% { transform: translateY(12px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// useFirstVisit — hardened hook
// ---------------------------------------------------------------------------

const WELCOMED_KEY = 'iliagpt_welcomed';

export function useFirstVisit() {
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [showExplosion, setShowExplosion] = useState(false);

  useEffect(() => {
    try {
      const hasVisited = localStorage.getItem(WELCOMED_KEY);
      if (!hasVisited) {
        setIsFirstVisit(true);
        setShowExplosion(true);
      }
    } catch {
      // localStorage unavailable (private browsing, storage full, etc.)
      // Fail silently — user just won't see the explosion
    }
  }, []);

  const completeWelcome = useCallback(() => {
    try {
      localStorage.setItem(WELCOMED_KEY, 'true');
    } catch {
      // Best-effort persist
    }
    setShowExplosion(false);
    setIsFirstVisit(false);
  }, []);

  return { isFirstVisit, showExplosion, completeWelcome };
}

// Re-export for backwards compatibility
export { WelcomeAnimation } from './welcome-animation-simple';
