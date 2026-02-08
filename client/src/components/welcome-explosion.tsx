import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, Zap, Brain, Rocket, Stars } from 'lucide-react';

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
}

interface Firework {
  x: number;
  y: number;
  targetY: number;
  speed: number;
  color: string;
  exploded: boolean;
  particles: Particle[];
  trail: { x: number; y: number; alpha: number }[];
}

const COLORS = [
  '#F8D34B', // Amber
  '#F06595', // Rose
  '#5CC8FF', // Sky
  '#6EE7B7', // Mint
  '#A78BFA', // Violet
  '#F97316', // Warm Orange
];

// Target physics at 60fps — all values are per-second for frame-rate independence
const TARGET_FPS = 60;
const GRAVITY = 0.06 * TARGET_FPS;         // ~3.6 px/s²
const VELOCITY_DAMPING = Math.pow(0.985, TARGET_FPS); // per-second damping
const LIFE_DECAY = 0.018 * TARGET_FPS;     // ~1.08 per second
const RISE_SPEED = 11 * TARGET_FPS;        // ~660 px/s
const CONFETTI_GRAVITY = 0.015 * TARGET_FPS;

export function WelcomeExplosion({ onComplete }: { onComplete?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'explosion' | 'welcome' | 'features' | 'ready'>('explosion');
  const [showContent, setShowContent] = useState(false);
  const fireworksRef = useRef<Firework[]>([]);
  const confettiRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>();
  const phaseRef = useRef<'explosion' | 'welcome' | 'features' | 'ready'>('explosion');
  const onCompleteRef = useRef(onComplete);
  const lastFrameTimeRef = useRef<number>(0);
  const initedRef = useRef(false);

  // Keep refs in sync without triggering effect re-runs
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    // Guard against double-initialization (React StrictMode)
    if (initedRef.current) return;
    initedRef.current = true;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const createFirework = (): Firework => {
      const screenH = window.innerHeight;
      return {
        x: Math.random() * window.innerWidth,
        y: screenH + 10,
        targetY: Math.random() * (screenH * 0.4) + screenH * 0.1,
        speed: RISE_SPEED * (0.85 + Math.random() * 0.3),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        exploded: false,
        particles: [],
        trail: []
      };
    };

    const explodeFirework = (fw: Firework) => {
      const particleCount = 35 + Math.floor(Math.random() * 15);
      for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.2;
        const speed = (2 + Math.random() * 4) * TARGET_FPS;
        const color = Math.random() > 0.3 ? fw.color : COLORS[Math.floor(Math.random() * COLORS.length)];

        fw.particles.push({
          x: fw.x,
          y: fw.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1.5 + Math.random() * 2.5,
          color,
          alpha: 1,
          life: 1,
          type: Math.random() > 0.75 ? 'star' : 'spark',
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.2 * TARGET_FPS
        });
      }
    };

    const createConfetti = (): Particle => {
      return {
        x: Math.random() * window.innerWidth,
        y: -20,
        vx: (Math.random() - 0.5) * 2.5 * TARGET_FPS,
        vy: (1.5 + Math.random() * 3) * TARGET_FPS,
        size: 5 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: 1,
        life: 1,
        type: 'confetti',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2 * TARGET_FPS
      };
    };

    // Staggered initial fireworks — slight delay for canvas to settle
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < 5; i++) {
      timeouts.push(setTimeout(() => {
        fireworksRef.current.push(createFirework());
      }, 100 + i * 200));
    }

    // Confetti spawner using refs to avoid stale closures
    const confettiInterval = setInterval(() => {
      if (phaseRef.current === 'explosion') {
        confettiRef.current.push(createConfetti());
      }
    }, 200);

    // Second wave
    timeouts.push(setTimeout(() => {
      for (let i = 0; i < 3; i++) {
        timeouts.push(setTimeout(() => {
          fireworksRef.current.push(createFirework());
        }, i * 280));
      }
    }, 900));

    // Third wave
    timeouts.push(setTimeout(() => {
      for (let i = 0; i < 2; i++) {
        timeouts.push(setTimeout(() => {
          fireworksRef.current.push(createFirework());
        }, i * 300));
      }
    }, 1500));

    // Phase transitions — content appears after first explosions
    timeouts.push(setTimeout(() => setShowContent(true), 600));
    timeouts.push(setTimeout(() => setPhase('welcome'), 1000));
    timeouts.push(setTimeout(() => setPhase('features'), 2100));
    timeouts.push(setTimeout(() => setPhase('ready'), 3400));
    timeouts.push(setTimeout(() => onCompleteRef.current?.(), 5000));

    const drawStar = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number, color: string, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const innerAngle = angle + Math.PI / 5;
        if (i === 0) {
          ctx.moveTo(Math.cos(angle) * size, Math.sin(angle) * size);
        } else {
          ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
        }
        ctx.lineTo(Math.cos(innerAngle) * size * 0.4, Math.sin(innerAngle) * size * 0.4);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    };

    const drawGlow = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha: number) => {
      // Use globalAlpha instead of embedding alpha in color strings per gradient stop
      ctx.save();
      ctx.globalAlpha = alpha * 0.78;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 2.2);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(x, y, size * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();

      // Draw core
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    };

    const animate = (timestamp: number) => {
      // Calculate delta time in seconds, capped to prevent spiral-of-death
      if (lastFrameTimeRef.current === 0) lastFrameTimeRef.current = timestamp;
      const rawDt = (timestamp - lastFrameTimeRef.current) / 1000;
      const dt = Math.min(rawDt, 1 / 30); // Cap at ~30fps equivalent step
      lastFrameTimeRef.current = timestamp;

      const elapsed = timestamp - startTimestamp;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Update and draw fireworks
      fireworksRef.current = fireworksRef.current.filter(fw => {
        if (!fw.exploded) {
          // Frame-rate independent rise
          fw.y -= fw.speed * dt;

          // Draw trail
          ctx.beginPath();
          ctx.arc(fw.x, fw.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = fw.color;
          ctx.fill();

          // Draw sparkle trail
          for (let i = 0; i < 3; i++) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.arc(fw.x + (Math.random() - 0.5) * 5, fw.y + i * 8, 1.6 - i * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = fw.color;
            ctx.fill();
            ctx.restore();
          }

          if (fw.y <= fw.targetY) {
            fw.exploded = true;
            explodeFirework(fw);
          }
          return true;
        }

        // Update explosion particles with delta-time
        fw.particles = fw.particles.filter(p => {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += GRAVITY * dt;
          p.vx *= Math.pow(VELOCITY_DAMPING, dt);
          p.life -= LIFE_DECAY * dt;
          p.alpha = Math.max(0, p.life);
          p.rotation += p.rotationSpeed * dt;

          if (p.life <= 0) return false;

          if (p.type === 'star') {
            drawStar(ctx, p.x, p.y, p.size, p.rotation, p.color, p.alpha);
          } else {
            drawGlow(ctx, p.x, p.y, p.size, p.color, p.alpha);
          }

          return true;
        });

        return fw.particles.length > 0 || !fw.exploded;
      });

      // Update and draw confetti with delta-time
      confettiRef.current = confettiRef.current.filter(c => {
        c.x += (c.vx + Math.sin(c.y * 0.02) * 0.35 * TARGET_FPS) * dt;
        c.y += c.vy * dt;
        c.rotation += c.rotationSpeed * dt;
        c.vy += CONFETTI_GRAVITY * dt;

        if (c.y > window.innerHeight + 20) return false;

        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rotation);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
        ctx.restore();

        return true;
      });

      if (elapsed < 5500) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    const startTimestamp = performance.now();
    lastFrameTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      clearInterval(confettiInterval);
      timeouts.forEach(t => clearTimeout(t));
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
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
      {/* Particle Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Content Overlay */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center px-6 transition-all duration-1000 ${showContent ? 'opacity-100' : 'opacity-0'}`}
        style={{ fontFamily: '"Space Grotesk", "Geist", "Inter", sans-serif' }}
      >
        {/* Main Logo Animation */}
        <div className={`relative mb-8 transition-all duration-700 ${phase !== 'explosion' ? 'scale-100' : 'scale-95'} ${phase !== 'explosion' ? 'opacity-100' : 'opacity-0'}`}>
          <div className="relative flex items-center justify-center">
            <div className="absolute w-32 h-32 rounded-full bg-white/5 blur-2xl" />
            <div className="w-24 h-24 rounded-full border border-white/20 bg-white/5 flex items-center justify-center shadow-[0_0_40px_rgba(92,200,255,0.25)]">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center">
                <Sparkles className="w-9 h-9 text-white/90" />
              </div>
            </div>
          </div>
        </div>

        {/* Welcome Text */}
        <div className={`text-center space-y-4 transition-all duration-700 ${phase !== 'explosion' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <p className="text-xs uppercase tracking-[0.4em] text-white/60">Bienvenido</p>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight">
            <span className="text-white/90">ILIAGPT</span>
          </h1>
          <p className={`text-base md:text-lg text-white/70 transition-all duration-500 delay-300 ${phase === 'welcome' || phase === 'features' || phase === 'ready' ? 'opacity-100' : 'opacity-0'}`}>
            Un asistente de IA premium para trabajo serio y creativo.
          </p>
        </div>

        {/* Feature Cards */}
        <div className={`mt-10 flex flex-wrap justify-center gap-3 max-w-2xl transition-all duration-700 ${phase === 'features' || phase === 'ready' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          {[
            { icon: Brain, label: 'IA Confiable', color: 'from-violet-400/30 to-purple-500/10' },
            { icon: Zap, label: 'Respuesta Ágil', color: 'from-sky-400/30 to-cyan-500/10' },
            { icon: Rocket, label: 'Flujo Continuo', color: 'from-emerald-400/30 to-teal-500/10' },
            { icon: Stars, label: 'Detalles Premium', color: 'from-rose-400/30 to-pink-500/10' },
          ].map((feature, idx) => (
            <div
              key={feature.label}
              className={`flex items-center gap-3 px-5 py-3 rounded-full bg-white/5 backdrop-blur border border-white/10 transform transition-all duration-500`}
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

        {/* Ready Message */}
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

      {/* CSS */}
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

// Hook to manage first visit
export function useFirstVisit() {
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [showExplosion, setShowExplosion] = useState(false);

  useEffect(() => {
    const hasVisited = localStorage.getItem('iliagpt_welcomed');
    if (!hasVisited) {
      setIsFirstVisit(true);
      setShowExplosion(true);
    }
  }, []);

  const completeWelcome = useCallback(() => {
    localStorage.setItem('iliagpt_welcomed', 'true');
    setShowExplosion(false);
    setIsFirstVisit(false);
  }, []);

  return { isFirstVisit, showExplosion, completeWelcome };
}

// Re-export original for backwards compatibility
export { WelcomeAnimation } from './welcome-animation-simple';
