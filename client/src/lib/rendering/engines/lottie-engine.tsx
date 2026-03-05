/**
 * Lottie Animation Engine
 * Renders After Effects animations for the web
 */

import React, { useRef, forwardRef, useImperativeHandle, useMemo } from 'react';
import Lottie from 'lottie-react';
import type { LottieConfig } from '../types';

// ============================================
// BUILT-IN ANIMATION DATA
// ============================================

const LOADING_ANIMATION = {
  v: '5.7.1',
  fr: 60,
  ip: 0,
  op: 120,
  w: 200,
  h: 200,
  nm: 'Loading',
  layers: [
    {
      ty: 4,
      nm: 'Circle 1',
      sr: 1,
      ks: {
        o: { a: 1, k: [{ t: 0, s: [100] }, { t: 60, s: [20] }, { t: 120, s: [100] }] },
        r: { a: 1, k: [{ t: 0, s: [0] }, { t: 120, s: [360] }] },
        p: { a: 0, k: [100, 100, 0] },
        s: { a: 1, k: [{ t: 0, s: [100, 100, 100] }, { t: 60, s: [60, 60, 100] }, { t: 120, s: [100, 100, 100] }] },
      },
      shapes: [
        {
          ty: 'el',
          d: 1,
          s: { a: 0, k: [80, 80] },
          p: { a: 0, k: [0, 0] },
        },
        {
          ty: 'st',
          c: { a: 0, k: [0.388, 0.4, 0.945, 1] },
          o: { a: 0, k: 100 },
          w: { a: 0, k: 6 },
          lc: 2,
          lj: 2,
          d: [
            { n: 'd', nm: 'dash', v: { a: 0, k: 40 } },
            { n: 'g', nm: 'gap', v: { a: 0, k: 20 } },
            { n: 'o', nm: 'offset', v: { a: 1, k: [{ t: 0, s: [0] }, { t: 120, s: [120] }] } },
          ],
        },
      ],
      ip: 0,
      op: 120,
    },
    {
      ty: 4,
      nm: 'Circle 2',
      sr: 1,
      ks: {
        o: { a: 1, k: [{ t: 0, s: [60] }, { t: 60, s: [100] }, { t: 120, s: [60] }] },
        r: { a: 1, k: [{ t: 0, s: [0] }, { t: 120, s: [-360] }] },
        p: { a: 0, k: [100, 100, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      shapes: [
        {
          ty: 'el',
          d: 1,
          s: { a: 0, k: [50, 50] },
          p: { a: 0, k: [0, 0] },
        },
        {
          ty: 'st',
          c: { a: 0, k: [0.925, 0.282, 0.6, 1] },
          o: { a: 0, k: 100 },
          w: { a: 0, k: 4 },
          lc: 2,
          lj: 2,
          d: [
            { n: 'd', nm: 'dash', v: { a: 0, k: 20 } },
            { n: 'g', nm: 'gap', v: { a: 0, k: 15 } },
            { n: 'o', nm: 'offset', v: { a: 1, k: [{ t: 0, s: [0] }, { t: 120, s: [-80] }] } },
          ],
        },
      ],
      ip: 0,
      op: 120,
    },
  ],
};

const SUCCESS_ANIMATION = {
  v: '5.7.1',
  fr: 60,
  ip: 0,
  op: 60,
  w: 200,
  h: 200,
  nm: 'Success',
  layers: [
    {
      ty: 4,
      nm: 'Checkmark',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [100, 100, 0] },
        s: { a: 1, k: [{ t: 0, s: [0, 0, 100] }, { t: 20, s: [110, 110, 100] }, { t: 30, s: [100, 100, 100] }] },
      },
      shapes: [
        {
          ty: 'el',
          d: 1,
          s: { a: 0, k: [80, 80] },
          p: { a: 0, k: [0, 0] },
        },
        {
          ty: 'fl',
          c: { a: 0, k: [0.063, 0.725, 0.506, 1] },
          o: { a: 0, k: 100 },
        },
      ],
      ip: 0,
      op: 60,
    },
  ],
};

const PULSE_ANIMATION = {
  v: '5.7.1',
  fr: 60,
  ip: 0,
  op: 90,
  w: 200,
  h: 200,
  nm: 'Pulse',
  layers: [
    {
      ty: 4,
      nm: 'Ring 1',
      sr: 1,
      ks: {
        o: { a: 1, k: [{ t: 0, s: [80] }, { t: 45, s: [0] }, { t: 90, s: [80] }] },
        p: { a: 0, k: [100, 100, 0] },
        s: { a: 1, k: [{ t: 0, s: [40, 40, 100] }, { t: 45, s: [120, 120, 100] }, { t: 90, s: [40, 40, 100] }] },
      },
      shapes: [
        { ty: 'el', d: 1, s: { a: 0, k: [80, 80] }, p: { a: 0, k: [0, 0] } },
        { ty: 'st', c: { a: 0, k: [0.024, 0.714, 0.831, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 3 } },
      ],
      ip: 0,
      op: 90,
    },
    {
      ty: 4,
      nm: 'Ring 2',
      sr: 1,
      ks: {
        o: { a: 1, k: [{ t: 15, s: [80] }, { t: 60, s: [0] }, { t: 90, s: [80] }] },
        p: { a: 0, k: [100, 100, 0] },
        s: { a: 1, k: [{ t: 15, s: [40, 40, 100] }, { t: 60, s: [120, 120, 100] }, { t: 90, s: [40, 40, 100] }] },
      },
      shapes: [
        { ty: 'el', d: 1, s: { a: 0, k: [80, 80] }, p: { a: 0, k: [0, 0] } },
        { ty: 'st', c: { a: 0, k: [0.388, 0.4, 0.945, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 3 } },
      ],
      ip: 0,
      op: 90,
    },
    {
      ty: 4,
      nm: 'Center dot',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        p: { a: 0, k: [100, 100, 0] },
        s: { a: 1, k: [{ t: 0, s: [100, 100, 100] }, { t: 22, s: [80, 80, 100] }, { t: 45, s: [100, 100, 100] }] },
      },
      shapes: [
        { ty: 'el', d: 1, s: { a: 0, k: [20, 20] }, p: { a: 0, k: [0, 0] } },
        { ty: 'fl', c: { a: 0, k: [0.925, 0.282, 0.6, 1] }, o: { a: 0, k: 100 } },
      ],
      ip: 0,
      op: 90,
    },
  ],
};

export type BuiltInAnimation = 'loading' | 'success' | 'pulse';

const BUILT_IN_ANIMATIONS: Record<BuiltInAnimation, object> = {
  loading: LOADING_ANIMATION,
  success: SUCCESS_ANIMATION,
  pulse: PULSE_ANIMATION,
};

// ============================================
// LOTTIE ENGINE COMPONENT
// ============================================

export interface LottieEngineProps {
  config?: LottieConfig;
  preset?: BuiltInAnimation;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
}

export interface LottieEngineRef {
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
  setDirection: (direction: 1 | -1) => void;
  goToFrame: (frame: number) => void;
  getDuration: () => number;
}

export const LottieEngine = forwardRef<LottieEngineRef, LottieEngineProps>(
  function LottieEngine({ config, preset, width = 300, height = 300, className, style, onReady }, ref) {
    const lottieRef = useRef<any>(null);

    const animationData = useMemo(() => {
      if (config?.animationData) return config.animationData;
      if (preset) return BUILT_IN_ANIMATIONS[preset];
      return BUILT_IN_ANIMATIONS.pulse; // Default
    }, [config?.animationData, preset]);

    useImperativeHandle(ref, () => ({
      play: () => lottieRef.current?.play(),
      pause: () => lottieRef.current?.pause(),
      stop: () => lottieRef.current?.stop(),
      setSpeed: (speed: number) => lottieRef.current?.setSpeed(speed),
      setDirection: (direction: 1 | -1) => lottieRef.current?.setDirection(direction),
      goToFrame: (frame: number) => lottieRef.current?.goToAndStop(frame, true),
      getDuration: () => lottieRef.current?.getDuration() || 0,
    }));

    return (
      <div
        className={className}
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
        }}
        data-testid="lottie-engine"
      >
        <Lottie
          lottieRef={lottieRef}
          animationData={animationData}
          loop={config?.loop ?? true}
          autoplay={config?.autoplay ?? true}
          style={{
            width: '100%',
            height: '100%',
            ...config?.style,
          }}
          onComplete={config?.onComplete}
          onLoopComplete={config?.onLoopComplete}
          onDOMLoaded={() => onReady?.()}
        />
      </div>
    );
  }
);

export { BUILT_IN_ANIMATIONS };
