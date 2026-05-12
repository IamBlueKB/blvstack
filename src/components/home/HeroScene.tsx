import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import * as THREE from 'three';

const COUNT = 1400;
const REPULSE_RADIUS = 0.9;
const REPULSE_STRENGTH = 0.06;
const RETURN_STRENGTH = 0.025;

// Shared NDC pointer, updated from window mousemove (bypasses canvas overlay blocking)
const windowPointer = { x: 0, y: 0, active: false };

function Particles() {
  const mesh = useRef<THREE.Points>(null);
  const { camera, size } = useThree();

  const { positions, originals, velocities } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const originals = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() - 0.5) * 6;
      const y = (Math.random() - 0.5) * 6;
      const z = (Math.random() - 0.5) * 3;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      originals[i * 3] = x;
      originals[i * 3 + 1] = y;
      originals[i * 3 + 2] = z;
    }
    return { positions, originals, velocities };
  }, []);

  const pointerWorld = useMemo(() => new THREE.Vector3(), []);
  const dirVec = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!mesh.current) return;

    // Use window-level NDC pointer (set by global mousemove listener below)
    pointerWorld.set(windowPointer.x, windowPointer.y, 0.5).unproject(camera);
    dirVec.copy(pointerWorld).sub(camera.position).normalize();
    const distance = -camera.position.z / dirVec.z;
    pointerWorld.copy(camera.position).add(dirVec.multiplyScalar(distance));

    const posAttr = mesh.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3;
      const iy = ix + 1;
      const iz = ix + 2;

      // Vector from pointer to particle
      const dx = arr[ix] - pointerWorld.x;
      const dy = arr[iy] - pointerWorld.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < REPULSE_RADIUS * REPULSE_RADIUS) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const force = (1 - dist / REPULSE_RADIUS) * REPULSE_STRENGTH;
        velocities[ix] += (dx / dist) * force;
        velocities[iy] += (dy / dist) * force;
      }

      // Return-to-origin spring
      velocities[ix] += (originals[ix] - arr[ix]) * RETURN_STRENGTH;
      velocities[iy] += (originals[iy] - arr[iy]) * RETURN_STRENGTH;
      velocities[iz] += (originals[iz] - arr[iz]) * RETURN_STRENGTH;

      // Damping
      velocities[ix] *= 0.88;
      velocities[iy] *= 0.88;
      velocities[iz] *= 0.88;

      // Apply
      arr[ix] += velocities[ix];
      arr[iy] += velocities[iy];
      arr[iz] += velocities[iz];
    }

    posAttr.needsUpdate = true;

    // Subtle base drift
    mesh.current.rotation.y = state.clock.elapsedTime * 0.025;
    mesh.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.02) * 0.06;
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.018}
        color="#2563EB"
        transparent
        opacity={0.65}
        sizeAttenuation
      />
    </points>
  );
}

// ---------- LogoParticles ----------
// Samples /logo.svg pixel data → maps to 3D positions → animates particles
// from random scatter into logo shape on mount, then idles with organic drift.

const LOGO_COUNT = 6000;
const LOGO_WIDTH_WORLD = 3.2;     // tuned to match solid B image size
const SAMPLE_SIZE = 320;
const ASSEMBLE_DURATION = 2.0;
const HOLD_DURATION = 0.5;        // hold formed B clearly visible
const FADE_OUT_START = 2.5;       // begin handoff after hold
const FADE_OUT_DURATION = 1.2;

function LogoParticles() {
  const mesh = useRef<THREE.Points>(null);
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const [data, setData] = useState<{ targets: Float32Array; starts: Float32Array } | null>(null);
  const startTime = useRef(0);
  const { camera, size } = useThree();

  // Compute world-space width matching the solid B image size (responsive)
  const computedWidth = useMemo(() => {
    const persp = camera as THREE.PerspectiveCamera;
    const vFov = (persp.fov * Math.PI) / 180;
    const aspect = size.width / size.height;
    const visibleHeight = 2 * Math.tan(vFov / 2) * Math.abs(persp.position.z);
    const visibleWidth = visibleHeight * aspect;
    // Match solid B css width: 60% mobile, 45% md, 38% lg
    let pct = 0.60;
    if (size.width >= 1024) pct = 0.38;
    else if (size.width >= 768) pct = 0.45;
    return visibleWidth * pct;
  }, [camera, size.width, size.height]);

  useEffect(() => {
    let mounted = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/b-mark.svg';
    img.onload = () => {
      if (!mounted) return;
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Fit logo to canvas with padding
      const aspect = img.width / img.height || 1;
      const padding = 20;
      let dw = SAMPLE_SIZE - padding * 2;
      let dh = dw / aspect;
      if (dh > SAMPLE_SIZE - padding * 2) {
        dh = SAMPLE_SIZE - padding * 2;
        dw = dh * aspect;
      }
      const dx = (SAMPLE_SIZE - dw) / 2;
      const dy = (SAMPLE_SIZE - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);

      let imageData: Uint8ClampedArray;
      try {
        imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
      } catch {
        return; // canvas tainted, skip silently
      }

      // Sample valid pixels (alpha > threshold) — every pixel for solid coverage
      const valid: Array<[number, number]> = [];
      for (let y = 0; y < SAMPLE_SIZE; y++) {
        for (let x = 0; x < SAMPLE_SIZE; x++) {
          const a = imageData[(y * SAMPLE_SIZE + x) * 4 + 3];
          if (a > 100) valid.push([x, y]);
        }
      }
      if (valid.length === 0) return;

      const scale = computedWidth / SAMPLE_SIZE;
      const offset = SAMPLE_SIZE / 2;
      const targets = new Float32Array(LOGO_COUNT * 3);
      const starts = new Float32Array(LOGO_COUNT * 3);

      for (let i = 0; i < LOGO_COUNT; i++) {
        const [px, py] = valid[Math.floor(Math.random() * valid.length)];
        targets[i * 3] = (px - offset) * scale;
        targets[i * 3 + 1] = (offset - py) * scale; // flip Y for 3D
        targets[i * 3 + 2] = (Math.random() - 0.5) * 0.05;

        // Random start position in a large sphere
        const r = 5 + Math.random() * 4;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        starts[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        starts[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starts[i * 3 + 2] = r * Math.cos(phi) * 0.4;
      }

      setData({ targets, starts });
      startTime.current = performance.now();
    };
    return () => { mounted = false; };
  }, []);

  // Pre-allocate working position buffer
  const positions = useMemo(() => new Float32Array(LOGO_COUNT * 3), []);

  useFrame((state) => {
    if (!mesh.current || !data) return;

    const posAttr = mesh.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    const elapsed = (performance.now() - startTime.current) / 1000;
    const t = Math.min(elapsed / ASSEMBLE_DURATION, 1);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const time = state.clock.elapsedTime;
    const driftAmp = ease * 0.025;

    for (let i = 0; i < LOGO_COUNT; i++) {
      const ix = i * 3;
      const iy = ix + 1;
      const iz = ix + 2;

      const dx = Math.sin(time * 0.6 + i * 0.13) * driftAmp;
      const dy = Math.cos(time * 0.5 + i * 0.17) * driftAmp;
      const dz = Math.sin(time * 0.4 + i * 0.21) * driftAmp * 0.4;

      arr[ix]     = data.starts[ix]     + (data.targets[ix]     - data.starts[ix])     * ease + dx;
      arr[iy] = data.starts[iy] + (data.targets[iy] - data.starts[iy]) * ease + dy;
      arr[iz] = data.starts[iz] + (data.targets[iz] - data.starts[iz]) * ease + dz;
    }
    posAttr.needsUpdate = true;

    // Fade particles out as solid B fades in (handoff)
    if (matRef.current) {
      let opacity = 0.9;
      if (elapsed > FADE_OUT_START) {
        const fadeT = Math.min((elapsed - FADE_OUT_START) / FADE_OUT_DURATION, 1);
        opacity = 0.9 * (1 - fadeT);
      }
      matRef.current.opacity = opacity;
    }
  });

  if (!data) return null;

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      <points ref={mesh}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={matRef}
          size={0.020}
          color="#2563EB"
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </group>
  );
}

// ---------- Logo3D ----------
// Loads /b-mark.svg → extrudes shapes into 3D geometry → metallic blue with emissive glow.
// Fades in after particle assembly handoff, then rotates continuously on Y-axis.

const LOGO3D_FADE_IN_START = 2.7;
const LOGO3D_FADE_IN_DURATION = 1.2;
const LOGO3D_SPIN_START = 2.7;
const LOGO3D_SPIN_SPEED = 0.4;
const LOGO3D_BASE_Y = 0.4; // vertical offset (positive = up)

function Logo3D() {
  const svgData = useLoader(SVGLoader, '/b-mark.svg');
  const groupRef = useRef<THREE.Group>(null);
  const matRefs = useRef<THREE.MeshStandardMaterial[]>([]);
  const mountTime = useRef(performance.now());
  const { size } = useThree();

  // Build extruded geometries from the SVG paths (skip light/cream paths)
  const meshes = useMemo(() => {
    const items: { geom: THREE.BufferGeometry; color: string }[] = [];
    const isLightColor = (hex: string) => {
      const h = hex.replace('#', '');
      if (h.length !== 6) return false;
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      // Treat near-white / cream as background
      return r > 200 && g > 200 && b > 200;
    };

    svgData.paths.forEach((path) => {
      const fill = (path as any).userData?.style?.fill || (path as any).color?.getHexString?.();
      const fillStr = typeof fill === 'string' ? (fill.startsWith('#') ? fill : '#' + fill) : '#2563EB';
      if (fillStr === 'none' || isLightColor(fillStr)) return;

      const shapes = SVGLoader.createShapes(path);
      shapes.forEach((shape) => {
        const geom = new THREE.ExtrudeGeometry(shape, {
          depth: 60,
          bevelEnabled: true,
          bevelSize: 6,
          bevelThickness: 6,
          bevelSegments: 3,
          curveSegments: 8,
        });
        geom.computeVertexNormals();
        items.push({ geom, color: fillStr });
      });
    });

    return items;
  }, [svgData]);

  // Compute bounding box for centering
  const { center, scale } = useMemo(() => {
    const box = new THREE.Box3();
    const tempMesh = new THREE.Mesh();
    meshes.forEach((m) => {
      tempMesh.geometry = m.geom;
      tempMesh.updateMatrixWorld();
      box.expandByObject(tempMesh);
    });
    const c = new THREE.Vector3();
    box.getCenter(c);
    const sizeV = new THREE.Vector3();
    box.getSize(sizeV);
    // Target B world width depending on viewport breakpoint
    const targetWidth =
      size.width >= 1024 ? 2.6 : size.width >= 768 ? 2.2 : 1.7;
    const s = targetWidth / sizeV.x;
    return { center: c, scale: s };
  }, [meshes, size.width]);

  useFrame(() => {
    if (!groupRef.current) return;
    const elapsed = (performance.now() - mountTime.current) / 1000;

    // Fade in
    const fadeT = Math.min(
      Math.max((elapsed - LOGO3D_FADE_IN_START) / LOGO3D_FADE_IN_DURATION, 0),
      1
    );
    matRefs.current.forEach((mat) => {
      if (mat) mat.opacity = fadeT;
    });

    // Spin
    if (elapsed > LOGO3D_SPIN_START) {
      groupRef.current.rotation.y =
        (elapsed - LOGO3D_SPIN_START) * LOGO3D_SPIN_SPEED;
    }

    // Subtle float — offset from base Y
    groupRef.current.position.y = LOGO3D_BASE_Y + Math.sin(elapsed * 0.4) * 0.05;
  });

  return (
    <group
      ref={groupRef}
      position={[0, 0.9, -0.5]}
      scale={[scale, -scale, scale]}
    >
      <group position={[-center.x, -center.y, -center.z]}>
        {meshes.map((m, i) => (
          <mesh key={i} geometry={m.geom} castShadow={false} receiveShadow={false}>
            <meshStandardMaterial
              ref={(el) => {
                if (el) matRefs.current[i] = el;
              }}
              color={m.color}
              emissive={m.color}
              emissiveIntensity={0.4}
              metalness={0.75}
              roughness={0.25}
              transparent
              opacity={0}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export default function HeroScene() {
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      windowPointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      windowPointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
      windowPointer.active = true;
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 60 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 6]} intensity={1.1} />
      <pointLight position={[-3, 2, 3]} color="#2563EB" intensity={3} distance={10} />
      <pointLight position={[3, -2, 3]} color="#1E40AF" intensity={2.5} distance={10} />
      <Particles />
      <LogoParticles />
      <Logo3D />
    </Canvas>
  );
}
