import React, { useEffect, useRef, useState } from 'react';
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
  color: string;
  exploded: boolean;
  particles: Particle[];
}

const COLORS = [
  '#FF6B6B', // Coral Red
  '#4ECDC4', // Turquoise
  '#45B7D1', // Sky Blue
  '#96CEB4', // Sage
  '#FFEAA7', // Pale Yellow
  '#DDA0DD', // Plum
  '#98D8C8', // Mint
  '#F7DC6F', // Gold
  '#BB8FCE', // Lavender
  '#85C1E9', // Light Blue
  '#F8B500', // Amber
  '#FF69B4', // Hot Pink
  '#00CED1', // Dark Turquoise
  '#FFD700', // Gold
  '#7B68EE', // Medium Slate Blue
];

const CONFETTI_SHAPES = ['square', 'circle', 'triangle'];

export function WelcomeExplosion({ onComplete }: { onComplete?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'explosion' | 'welcome' | 'features' | 'ready'>('explosion');
  const [showContent, setShowContent] = useState(false);
  const fireworksRef = useRef<Firework[]>([]);
  const confettiRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>();
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const createFirework = (): Firework => {
      return {
        x: Math.random() * window.innerWidth,
        y: window.innerHeight + 10,
        targetY: Math.random() * (window.innerHeight * 0.4) + window.innerHeight * 0.1,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        exploded: false,
        particles: []
      };
    };

    const explodeFirework = (fw: Firework) => {
      const particleCount = 80 + Math.floor(Math.random() * 40);
      for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.2;
        const speed = 3 + Math.random() * 6;
        const color = Math.random() > 0.3 ? fw.color : COLORS[Math.floor(Math.random() * COLORS.length)];
        
        fw.particles.push({
          x: fw.x,
          y: fw.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2 + Math.random() * 4,
          color,
          alpha: 1,
          life: 1,
          type: Math.random() > 0.7 ? 'star' : 'spark',
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.2
        });
      }
    };

    const createConfetti = (): Particle => {
      return {
        x: Math.random() * window.innerWidth,
        y: -20,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        size: 8 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: 1,
        life: 1,
        type: 'confetti',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.3
      };
    };

    // Initial fireworks burst
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        fireworksRef.current.push(createFirework());
      }, i * 150);
    }

    // Continuous confetti
    const confettiInterval = setInterval(() => {
      if (phase === 'explosion' || phase === 'welcome') {
        for (let i = 0; i < 5; i++) {
          confettiRef.current.push(createConfetti());
        }
      }
    }, 100);

    // More fireworks waves
    setTimeout(() => {
      for (let i = 0; i < 6; i++) {
        setTimeout(() => {
          fireworksRef.current.push(createFirework());
        }, i * 200);
      }
    }, 800);

    setTimeout(() => {
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          fireworksRef.current.push(createFirework());
        }, i * 250);
      }
    }, 1600);

    // Phase transitions
    setTimeout(() => setShowContent(true), 500);
    setTimeout(() => setPhase('welcome'), 1000);
    setTimeout(() => setPhase('features'), 2500);
    setTimeout(() => setPhase('ready'), 4500);
    setTimeout(() => onComplete?.(), 6000);

    const drawStar = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number, color: string, alpha: number) => {
      ctx.save();
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
      ctx.fillStyle = color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();
      ctx.restore();
    };

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Update and draw fireworks
      fireworksRef.current = fireworksRef.current.filter(fw => {
        if (!fw.exploded) {
          fw.y -= 12;
          
          // Draw trail
          ctx.beginPath();
          ctx.arc(fw.x, fw.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = fw.color;
          ctx.fill();
          
          // Draw sparkle trail
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(fw.x + (Math.random() - 0.5) * 6, fw.y + i * 8, 2 - i * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = fw.color + '80';
            ctx.fill();
          }

          if (fw.y <= fw.targetY) {
            fw.exploded = true;
            explodeFirework(fw);
          }
          return true;
        }

        // Update explosion particles
        fw.particles = fw.particles.filter(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.08; // gravity
          p.vx *= 0.98;
          p.life -= 0.015;
          p.alpha = p.life;
          p.rotation += p.rotationSpeed;

          if (p.life <= 0) return false;

          if (p.type === 'star') {
            drawStar(ctx, p.x, p.y, p.size, p.rotation, p.color, p.alpha);
          } else {
            // Draw glow
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
            gradient.addColorStop(0, p.color + Math.floor(p.alpha * 200).toString(16).padStart(2, '0'));
            gradient.addColorStop(1, p.color + '00');
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();

            // Draw core
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color + Math.floor(p.alpha * 255).toString(16).padStart(2, '0');
            ctx.fill();
          }

          return true;
        });

        return fw.particles.length > 0 || !fw.exploded;
      });

      // Update and draw confetti
      confettiRef.current = confettiRef.current.filter(c => {
        c.x += c.vx + Math.sin(c.y * 0.02) * 0.5;
        c.y += c.vy;
        c.rotation += c.rotationSpeed;
        c.vy += 0.02;

        if (c.y > window.innerHeight + 20) return false;

        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rotation);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
        ctx.restore();

        return true;
      });

      if (elapsed < 7000) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      clearInterval(confettiInterval);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [onComplete, phase]);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 via-purple-900/30 to-slate-900 overflow-hidden">
      {/* Particle Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />

      {/* Content Overlay */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-1000 ${showContent ? 'opacity-100' : 'opacity-0'}`}>
        {/* Main Logo Animation */}
        <div className={`relative mb-8 transition-all duration-700 ${phase !== 'explosion' ? 'scale-100' : 'scale-0'}`}>
          <div className="absolute inset-0 animate-ping opacity-30">
            <div className="w-32 h-32 rounded-full bg-gradient-to-r from-yellow-400 via-pink-500 to-purple-500" />
          </div>
          <div className="absolute inset-0 animate-spin-slow">
            <div className="w-32 h-32 rounded-full border-4 border-dashed border-cyan-400/50" />
          </div>
          <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-yellow-400 via-orange-500 to-pink-600 flex items-center justify-center shadow-2xl shadow-orange-500/50">
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-purple-600 via-pink-500 to-yellow-400 animate-pulse" />
            <Sparkles className="relative w-16 h-16 text-white drop-shadow-lg" />
          </div>
        </div>

        {/* Welcome Text */}
        <div className={`text-center space-y-4 transition-all duration-700 ${phase !== 'explosion' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <h1 className="text-5xl md:text-7xl font-black">
            <span className="bg-gradient-to-r from-yellow-300 via-pink-400 to-purple-400 bg-clip-text text-transparent animate-gradient drop-shadow-lg">
              ¡BIENVENIDO!
            </span>
          </h1>
          
          <div className={`transition-all duration-500 delay-500 ${phase === 'welcome' || phase === 'features' || phase === 'ready' ? 'opacity-100' : 'opacity-0'}`}>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">
              🚀 ILIAGPT 🚀
            </h2>
            <p className="text-xl text-purple-200">
              Tu asistente de IA más poderoso
            </p>
          </div>
        </div>

        {/* Feature Cards */}
        <div className={`mt-10 flex flex-wrap justify-center gap-4 max-w-2xl px-4 transition-all duration-700 ${phase === 'features' || phase === 'ready' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          {[
            { icon: Brain, label: 'IA Inteligente', color: 'from-purple-500 to-pink-500' },
            { icon: Zap, label: 'Ultra Rápido', color: 'from-yellow-400 to-orange-500' },
            { icon: Rocket, label: 'Sin Límites', color: 'from-cyan-400 to-blue-500' },
            { icon: Stars, label: 'Magia Pura', color: 'from-pink-400 to-red-500' },
          ].map((feature, idx) => (
            <div
              key={feature.label}
              className={`flex items-center gap-3 px-5 py-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 transform transition-all duration-500`}
              style={{ 
                transitionDelay: `${idx * 100}ms`,
                animation: phase === 'features' || phase === 'ready' ? `bounce-in 0.5s ease-out ${idx * 100}ms both` : 'none'
              }}
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center`}>
                <feature.icon className="w-5 h-5 text-white" />
              </div>
              <span className="text-white font-semibold">{feature.label}</span>
            </div>
          ))}
        </div>

        {/* Ready Message */}
        <div className={`mt-10 transition-all duration-700 ${phase === 'ready' ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
          <button
            onClick={onComplete}
            className="px-8 py-4 rounded-2xl bg-gradient-to-r from-yellow-400 via-pink-500 to-purple-500 text-white font-bold text-xl shadow-2xl shadow-pink-500/30 hover:shadow-pink-500/50 transform hover:scale-105 transition-all duration-300 animate-pulse"
          >
            ✨ ¡Comenzar Ahora! ✨
          </button>
        </div>
      </div>

      {/* CSS */}
      <style>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 2s ease infinite;
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 8s linear infinite;
        }
        @keyframes bounce-in {
          0% { transform: scale(0) translateY(20px); opacity: 0; }
          60% { transform: scale(1.1) translateY(-5px); }
          100% { transform: scale(1) translateY(0); opacity: 1; }
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

  const completeWelcome = () => {
    localStorage.setItem('iliagpt_welcomed', 'true');
    setShowExplosion(false);
    setIsFirstVisit(false);
  };

  return { isFirstVisit, showExplosion, completeWelcome };
}

// Re-export original for backwards compatibility
export { WelcomeAnimation } from './welcome-animation-simple';
