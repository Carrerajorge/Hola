/**
 * React Spring Animation Engine
 * Physics-based animations for React components
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useSpring, useSprings, useTrail, useTransition, animated, config as springConfigs } from '@react-spring/web';
import type { SpringAnimationConfig } from '../types';

// ============================================
// ANIMATION PRESETS
// ============================================

export const SPRING_PRESETS = {
  gentle: { mass: 1, tension: 120, friction: 14 },
  wobbly: { mass: 1, tension: 180, friction: 12 },
  stiff: { mass: 1, tension: 210, friction: 20 },
  slow: { mass: 1, tension: 280, friction: 60 },
  molasses: { mass: 1, tension: 280, friction: 120 },
  bouncy: { mass: 1, tension: 300, friction: 10 },
} as const;

// ============================================
// ANIMATED CARD COMPONENT
// ============================================

interface AnimatedCardProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  hover?: boolean;
}

export function AnimatedCard({ children, delay = 0, className, hover = true }: AnimatedCardProps) {
  const [hovered, setHovered] = useState(false);

  const springProps = useSpring({
    from: { opacity: 0, transform: 'translateY(40px) scale(0.95)' },
    to: { opacity: 1, transform: 'translateY(0px) scale(1)' },
    delay,
    config: SPRING_PRESETS.gentle,
  });

  const hoverProps = useSpring({
    transform: hovered ? 'translateY(-4px) scale(1.02)' : 'translateY(0px) scale(1)',
    boxShadow: hovered
      ? '0 20px 40px rgba(0,0,0,0.15)'
      : '0 4px 12px rgba(0,0,0,0.05)',
    config: { mass: 1, tension: 300, friction: 20 },
  });

  return (
    <animated.div
      style={{ ...springProps, ...(hover ? hoverProps : {}) }}
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </animated.div>
  );
}

// ============================================
// ANIMATED LIST (TRAIL)
// ============================================

interface AnimatedListProps {
  items: Array<{ id: string; content: React.ReactNode }>;
  className?: string;
  itemClassName?: string;
}

export function AnimatedList({ items, className, itemClassName }: AnimatedListProps) {
  const trail = useTrail(items.length, {
    from: { opacity: 0, transform: 'translateX(-20px)' },
    to: { opacity: 1, transform: 'translateX(0px)' },
    config: SPRING_PRESETS.gentle,
  });

  return (
    <div className={className}>
      {trail.map((props, index) => (
        <animated.div key={items[index].id} style={props} className={itemClassName}>
          {items[index].content}
        </animated.div>
      ))}
    </div>
  );
}

// ============================================
// ANIMATED COUNTER
// ============================================

interface AnimatedCounterProps {
  value: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export function AnimatedCounter({ value, className, prefix = '', suffix = '', decimals = 0 }: AnimatedCounterProps) {
  const { number } = useSpring({
    from: { number: 0 },
    to: { number: value },
    delay: 200,
    config: { mass: 1, tension: 20, friction: 10 },
  });

  return (
    <animated.span className={className}>
      {number.to((n) => `${prefix}${n.toFixed(decimals)}${suffix}`)}
    </animated.span>
  );
}

// ============================================
// ANIMATED PROGRESS BAR
// ============================================

interface AnimatedProgressProps {
  value: number; // 0-100
  color?: string;
  height?: number;
  className?: string;
  showLabel?: boolean;
}

export function AnimatedProgress({ value, color = '#6366f1', height = 8, className, showLabel }: AnimatedProgressProps) {
  const props = useSpring({
    width: `${Math.min(100, Math.max(0, value))}%`,
    config: SPRING_PRESETS.gentle,
  });

  return (
    <div className={className}>
      <div
        style={{
          width: '100%',
          height,
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: height / 2,
          overflow: 'hidden',
        }}
      >
        <animated.div
          style={{
            ...props,
            height: '100%',
            backgroundColor: color,
            borderRadius: height / 2,
          }}
        />
      </div>
      {showLabel && (
        <AnimatedCounter value={value} suffix="%" className="text-sm text-muted-foreground mt-1 block" />
      )}
    </div>
  );
}

// ============================================
// ANIMATED PRESENCE (TRANSITIONS)
// ============================================

interface AnimatedPresenceProps {
  show: boolean;
  children: React.ReactNode;
  type?: 'fade' | 'slide' | 'scale' | 'flip';
  className?: string;
}

export function AnimatedPresence({ show, children, type = 'fade', className }: AnimatedPresenceProps) {
  const transitions = useTransition(show, {
    from: getTransitionFrom(type),
    enter: getTransitionEnter(type),
    leave: getTransitionFrom(type),
    config: SPRING_PRESETS.gentle,
  });

  return (
    <>
      {transitions((styles, item) =>
        item ? (
          <animated.div style={styles} className={className}>
            {children}
          </animated.div>
        ) : null
      )}
    </>
  );
}

function getTransitionFrom(type: string) {
  switch (type) {
    case 'slide':
      return { opacity: 0, transform: 'translateY(20px)' };
    case 'scale':
      return { opacity: 0, transform: 'scale(0.8)' };
    case 'flip':
      return { opacity: 0, transform: 'rotateX(90deg)' };
    default:
      return { opacity: 0 };
  }
}

function getTransitionEnter(type: string) {
  switch (type) {
    case 'slide':
      return { opacity: 1, transform: 'translateY(0px)' };
    case 'scale':
      return { opacity: 1, transform: 'scale(1)' };
    case 'flip':
      return { opacity: 1, transform: 'rotateX(0deg)' };
    default:
      return { opacity: 1 };
  }
}

// ============================================
// MORPHING SHAPES
// ============================================

interface MorphingShapeProps {
  width?: number;
  height?: number;
  colors?: string[];
  className?: string;
}

export function MorphingShape({ width = 200, height = 200, colors, className }: MorphingShapeProps) {
  const [index, setIndex] = useState(0);
  const shapeColors = colors || ['#6366f1', '#ec4899', '#06b6d4', '#10b981', '#f59e0b'];

  const shapes = useMemo(() => [
    `M${width * 0.5},${height * 0.1} L${width * 0.9},${height * 0.35} L${width * 0.75},${height * 0.8} L${width * 0.25},${height * 0.8} L${width * 0.1},${height * 0.35} Z`,
    `M${width * 0.5},${height * 0.05} L${width * 0.95},${height * 0.5} L${width * 0.5},${height * 0.95} L${width * 0.05},${height * 0.5} Z`,
    `M${width * 0.5},${height * 0.15} Q${width * 0.85},${height * 0.15} ${width * 0.85},${height * 0.5} Q${width * 0.85},${height * 0.85} ${width * 0.5},${height * 0.85} Q${width * 0.15},${height * 0.85} ${width * 0.15},${height * 0.5} Q${width * 0.15},${height * 0.15} ${width * 0.5},${height * 0.15} Z`,
    `M${width * 0.5},${height * 0.05} L${width * 0.62},${height * 0.38} L${width * 0.98},${height * 0.38} L${width * 0.68},${height * 0.58} L${width * 0.79},${height * 0.92} L${width * 0.5},${height * 0.72} L${width * 0.21},${height * 0.92} L${width * 0.32},${height * 0.58} L${width * 0.02},${height * 0.38} L${width * 0.38},${height * 0.38} Z`,
  ], [width, height]);

  const { d, fill } = useSpring({
    d: shapes[index % shapes.length],
    fill: shapeColors[index % shapeColors.length],
    config: { mass: 2, tension: 120, friction: 20 },
  });

  const handleClick = useCallback(() => {
    setIndex((i) => (i + 1) % shapes.length);
  }, [shapes.length]);

  return (
    <svg
      width={width}
      height={height}
      className={className}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
      data-testid="morphing-shape"
    >
      <animated.path d={d} fill={fill} opacity={0.8} />
    </svg>
  );
}

// ============================================
// SPRING ENGINE DEMO COMPONENT
// ============================================

export interface SpringEngineProps {
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
}

export function SpringEngine({ className, style, width = '100%', height = 400 }: SpringEngineProps) {
  const items = useMemo(
    () =>
      ['React Spring', 'Physics-based', 'Animations', 'Morphing', 'Transitions'].map((label, i) => ({
        id: `item-${i}`,
        content: (
          <div
            style={{
              padding: '12px 20px',
              borderRadius: '8px',
              background: `linear-gradient(135deg, ${['#6366f1', '#ec4899', '#06b6d4', '#10b981', '#f59e0b'][i]}22, ${['#6366f1', '#ec4899', '#06b6d4', '#10b981', '#f59e0b'][i]}44)`,
              border: `1px solid ${['#6366f1', '#ec4899', '#06b6d4', '#10b981', '#f59e0b'][i]}44`,
              color: '#e2e8f0',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            {label}
          </div>
        ),
      })),
    []
  );

  return (
    <div
      className={className}
      style={{
        width,
        height,
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        backgroundColor: '#1e1e2e',
        borderRadius: '8px',
        overflow: 'auto',
        ...style,
      }}
      data-testid="spring-engine"
    >
      <AnimatedCard delay={0}>
        <h3 style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
          React Spring Animations
        </h3>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>
          Physics-based animations for fluid UX
        </p>
      </AnimatedCard>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
        <MorphingShape width={120} height={120} />
        <div style={{ flex: 1 }}>
          <AnimatedProgress value={75} color="#6366f1" showLabel />
          <div style={{ height: '12px' }} />
          <AnimatedProgress value={50} color="#ec4899" showLabel />
          <div style={{ height: '12px' }} />
          <AnimatedProgress value={90} color="#06b6d4" showLabel />
        </div>
      </div>

      <AnimatedList items={items} className="flex flex-col gap-2" />

      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
        <AnimatedCounter value={1234} prefix="$" className="text-2xl font-bold text-indigo-400" />
        <AnimatedCounter value={98.5} suffix="%" decimals={1} className="text-2xl font-bold text-pink-400" />
        <AnimatedCounter value={42} className="text-2xl font-bold text-cyan-400" />
      </div>
    </div>
  );
}
