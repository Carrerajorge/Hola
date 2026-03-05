/**
 * React Three Fiber (R3F) Engine
 * Declarative 3D rendering with Three.js
 */

import React, { useRef, useMemo, Suspense, forwardRef, useImperativeHandle } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  Text3D,
  Center,
  Float,
  MeshWobbleMaterial,
  MeshDistortMaterial,
  Stars,
  Sparkles,
  Html,
  PresentationControls,
  Stage,
  ContactShadows,
  Grid,
} from '@react-three/drei';
import { useSpring, animated } from '@react-spring/three';
import * as THREE from 'three';
import type { R3FSceneConfig, R3FObjectConfig } from '../types';

// ============================================
// ANIMATED PRIMITIVE OBJECTS
// ============================================

function AnimatedBox({ config }: { config: R3FObjectConfig }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = React.useState(false);

  const { scale } = useSpring({
    scale: hovered ? 1.2 : 1,
    config: { mass: 1, tension: 170, friction: 26 },
  });

  useFrame((_, delta) => {
    if (meshRef.current && config.animate?.rotation) {
      meshRef.current.rotation.x += config.animate.rotation[0] * delta;
      meshRef.current.rotation.y += config.animate.rotation[1] * delta;
      meshRef.current.rotation.z += config.animate.rotation[2] * delta;
    }
  });

  const material = useMemo(() => {
    const color = config.color || '#6366f1';
    switch (config.material) {
      case 'toon':
        return <meshToonMaterial color={color} />;
      case 'wireframe':
        return <meshStandardMaterial color={color} wireframe />;
      case 'physical':
        return <meshPhysicalMaterial color={color} roughness={0.1} metalness={0.8} clearcoat={1} />;
      case 'glass':
        return <meshPhysicalMaterial color={color} transmission={0.9} roughness={0} thickness={1} />;
      default:
        return <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />;
    }
  }, [config.color, config.material]);

  const geometry = useMemo(() => {
    switch (config.type) {
      case 'sphere':
        return <sphereGeometry args={[1, 32, 32]} />;
      case 'cylinder':
        return <cylinderGeometry args={[1, 1, 2, 32]} />;
      case 'torus':
        return <torusGeometry args={[1, 0.4, 16, 32]} />;
      case 'plane':
        return <planeGeometry args={[2, 2]} />;
      default:
        return <boxGeometry args={[1, 1, 1]} />;
    }
  }, [config.type]);

  const scaleValue = typeof config.scale === 'number'
    ? [config.scale, config.scale, config.scale] as [number, number, number]
    : config.scale || [1, 1, 1];

  return (
    <animated.mesh
      ref={meshRef}
      position={config.position || [0, 0, 0]}
      rotation={config.rotation || [0, 0, 0]}
      scale={scale.to((s) => [
        s * scaleValue[0],
        s * scaleValue[1],
        s * scaleValue[2],
      ])}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      castShadow
      receiveShadow
    >
      {geometry}
      {material}
    </animated.mesh>
  );
}

function ParticleSystem({ config }: { config: R3FObjectConfig }) {
  const count = 500;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      pos[i] = (Math.random() - 0.5) * 10;
    }
    return pos;
  }, []);

  return (
    <group position={config.position || [0, 0, 0]}>
      <Sparkles
        count={count}
        scale={10}
        size={3}
        speed={0.4}
        color={config.color || '#6366f1'}
      />
    </group>
  );
}

function TextObject({ config }: { config: R3FObjectConfig }) {
  return (
    <Center position={config.position || [0, 0, 0]}>
      <Float speed={2} floatIntensity={1}>
        <Text3D
          font="/fonts/inter_bold.json"
          size={0.75}
          height={0.2}
          curveSegments={12}
        >
          {config.text || 'Hello 3D'}
          <meshStandardMaterial color={config.color || '#6366f1'} />
        </Text3D>
      </Float>
    </Center>
  );
}

// ============================================
// SCENE OBJECT FACTORY
// ============================================

function SceneObject({ config }: { config: R3FObjectConfig }) {
  switch (config.type) {
    case 'particles':
      return <ParticleSystem config={config} />;
    case 'text':
      return <TextObject config={config} />;
    default:
      return <AnimatedBox config={config} />;
  }
}

// ============================================
// SCENE LIGHTING
// ============================================

function SceneLights({ lights }: { lights?: R3FSceneConfig['lights'] }) {
  if (!lights || lights.length === 0) {
    return (
      <>
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
        <pointLight position={[-5, 5, -5]} intensity={0.5} />
      </>
    );
  }

  return (
    <>
      {lights.map((light, index) => {
        const key = `light-${index}`;
        switch (light.type) {
          case 'ambient':
            return <ambientLight key={key} intensity={light.intensity ?? 0.5} color={light.color} />;
          case 'directional':
            return (
              <directionalLight
                key={key}
                position={light.position || [5, 5, 5]}
                intensity={light.intensity ?? 1}
                color={light.color}
                castShadow
              />
            );
          case 'point':
            return (
              <pointLight
                key={key}
                position={light.position || [0, 5, 0]}
                intensity={light.intensity ?? 1}
                color={light.color}
              />
            );
          case 'spot':
            return (
              <spotLight
                key={key}
                position={light.position || [0, 5, 0]}
                intensity={light.intensity ?? 1}
                color={light.color}
                castShadow
              />
            );
          case 'hemisphere':
            return (
              <hemisphereLight
                key={key}
                intensity={light.intensity ?? 0.5}
                color={light.color || '#ffffff'}
                groundColor="#444444"
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

// ============================================
// SCENE CONTROLS
// ============================================

function SceneControls({ controls }: { controls?: R3FSceneConfig['controls'] }) {
  if (!controls) {
    return <OrbitControls makeDefault enableDamping dampingFactor={0.05} />;
  }

  return (
    <OrbitControls
      makeDefault
      enableZoom={controls.enableZoom ?? true}
      enablePan={controls.enablePan ?? true}
      enableRotate={controls.enableRotate ?? true}
      autoRotate={controls.autoRotate ?? false}
      autoRotateSpeed={controls.autoRotateSpeed ?? 2}
      enableDamping
      dampingFactor={0.05}
    />
  );
}

// ============================================
// SCENE CONTENT
// ============================================

function SceneContent({ config }: { config: R3FSceneConfig }) {
  return (
    <>
      <SceneLights lights={config.lights} />
      <SceneControls controls={config.controls} />

      {config.environment && (
        <Environment preset={config.environment} />
      )}

      {config.objects?.map((obj, index) => (
        <SceneObject key={`obj-${index}`} config={obj} />
      ))}

      <ContactShadows
        position={[0, -1.5, 0]}
        opacity={0.4}
        scale={10}
        blur={2}
        far={4}
      />
    </>
  );
}

// ============================================
// DEFAULT DEMO SCENE
// ============================================

function DefaultDemoScene() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={1} castShadow />

      <Float speed={2} rotationIntensity={1} floatIntensity={2}>
        <mesh castShadow>
          <torusKnotGeometry args={[1, 0.35, 128, 32]} />
          <MeshDistortMaterial color="#6366f1" speed={2} distort={0.3} radius={1} />
        </mesh>
      </Float>

      <mesh position={[3, 0, -2]} castShadow>
        <sphereGeometry args={[0.8, 32, 32]} />
        <MeshWobbleMaterial color="#ec4899" speed={1} factor={0.6} />
      </mesh>

      <mesh position={[-3, 0, -1]} castShadow>
        <octahedronGeometry args={[1, 0]} />
        <meshPhysicalMaterial color="#06b6d4" roughness={0} metalness={1} />
      </mesh>

      <Stars radius={100} depth={50} count={1000} factor={4} fade speed={1} />
      <ContactShadows position={[0, -2, 0]} opacity={0.5} scale={20} blur={2} />
      <OrbitControls makeDefault autoRotate autoRotateSpeed={0.5} enableDamping />
      <Environment preset="city" />
    </>
  );
}

// ============================================
// R3F ENGINE COMPONENT
// ============================================

export interface R3FEngineProps {
  config?: R3FSceneConfig;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
}

export interface R3FEngineRef {
  takeScreenshot: () => string | null;
  resetCamera: () => void;
}

export const R3FEngine = forwardRef<R3FEngineRef, R3FEngineProps>(
  function R3FEngine({ config, width = '100%', height = 400, className, style, onReady }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useImperativeHandle(ref, () => ({
      takeScreenshot() {
        if (canvasRef.current) {
          return canvasRef.current.toDataURL('image/png');
        }
        return null;
      },
      resetCamera() {
        // Camera reset handled by controls
      },
    }));

    const cameraConfig = config?.camera || {
      position: [5, 3, 5] as [number, number, number],
      fov: 50,
    };

    return (
      <div
        className={className}
        style={{
          width,
          height,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '8px',
          ...style,
        }}
      >
        <Canvas
          ref={canvasRef}
          camera={{
            position: cameraConfig.position || [5, 3, 5],
            fov: cameraConfig.fov || 50,
            near: cameraConfig.near || 0.1,
            far: cameraConfig.far || 1000,
          }}
          shadows
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          onCreated={() => onReady?.()}
        >
          <Suspense fallback={null}>
            {config?.objects && config.objects.length > 0 ? (
              <SceneContent config={config} />
            ) : (
              <DefaultDemoScene />
            )}
          </Suspense>
        </Canvas>
      </div>
    );
  }
);
