/**
 * JANET — the circuit-glass orb (spec: flagship identity element).
 *
 * A glass sphere with a glowing cellular circuit network mapped on its surface,
 * energy travelling along fixed traces, and a core glowing through. Built as
 * layered additive shells so front + back traces accumulate into real
 * volumetric depth — no postprocessing dependency, no scene lights (fully
 * shader-driven fresnel + emission), render-gated when inactive.
 *
 * State-reactive (the functional part):
 *   idle      — slow rotation, dim core, gentle pulses
 *   working   — traces brighten, pulses accelerate, core intensifies
 *   alert     — warm gold accent, core breathes to signal "your input needed"
 *   briefing  — calm, cool, steady glow (Phase 6)
 *
 * Uniforms are eased toward per-state targets every frame, so transitions are
 * smooth rather than instant. Restraint over decoration — proportion, light,
 * and motion carry it.
 */
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type OrbState = 'idle' | 'working' | 'alert' | 'briefing';

// Brand tokens (globals.css @theme)
const ELECTRIC = new THREE.Color('#2563EB');
const WHITE_BLUE = new THREE.Color('#9DC1FF');
const GOLD = new THREE.Color('#EBB24E');
const COOL = new THREE.Color('#BFE0FF');

type Targets = { intensity: number; speed: number; core: number; hot: THREE.Color; breathe: number };

function targetsFor(state: OrbState): Targets {
  switch (state) {
    case 'working':
      return { intensity: 1.0, speed: 1.35, core: 1.0, hot: WHITE_BLUE, breathe: 0 };
    case 'alert':
      return { intensity: 0.92, speed: 0.85, core: 0.9, hot: GOLD, breathe: 1 };
    case 'briefing':
      return { intensity: 0.62, speed: 0.45, core: 0.7, hot: COOL, breathe: 0 };
    case 'idle':
    default:
      return { intensity: 0.5, speed: 0.32, core: 0.48, hot: WHITE_BLUE, breathe: 0 };
  }
}

const SHELL_VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const SHELL_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vPos;
  varying vec3 vNormalV;
  varying vec3 vViewDir;

  uniform float uTime;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uCore;
  uniform vec3  uBase;
  uniform vec3  uHot;

  vec3 hash3(vec3 p){
    p = vec3(dot(p,vec3(127.1,311.7,74.7)),
             dot(p,vec3(269.5,183.3,246.1)),
             dot(p,vec3(113.5,271.9,124.6)));
    return fract(sin(p)*43758.5453);
  }

  // Worley — returns (F1, F2) and stashes nearest feature id via out param.
  vec2 worley(vec3 p, out vec3 cellId){
    vec3 n = floor(p);
    vec3 f = fract(p);
    float f1 = 1e9, f2 = 1e9;
    cellId = vec3(0.0);
    for(int k=-1;k<=1;k++)
    for(int j=-1;j<=1;j++)
    for(int i=-1;i<=1;i++){
      vec3 g = vec3(float(i),float(j),float(k));
      vec3 o = hash3(n+g);
      vec3 d = g + o - f;
      float dist = length(d);
      if(dist < f1){ f2 = f1; f1 = dist; cellId = n+g; }
      else if(dist < f2){ f2 = dist; }
    }
    return vec2(f1, f2);
  }

  void main(){
    // Fixed cellular topology in object space (rotates with the mesh).
    vec3 p = normalize(vPos) * 2.7;
    vec3 cellId;
    vec2 w = worley(p, cellId);

    // Traces = cell edges (small F2-F1); nodes = near feature points (small F1).
    float edge = 1.0 - smoothstep(0.015, 0.06, w.y - w.x);
    float node = 1.0 - smoothstep(0.0, 0.14, w.x);
    node = pow(node, 2.2);

    // Energy travelling along the fixed traces: two slow orthogonal waves.
    float phase = uTime * uSpeed;
    float wave = 0.5 + 0.5 * sin(phase + vPos.y * 3.4 + vPos.x * 1.3);
    float wave2 = 0.5 + 0.5 * sin(phase * 0.6 - vPos.z * 2.6 + 1.7);
    float flow = mix(0.32, 1.0, wave) * mix(0.6, 1.0, wave2);

    // Per-node gentle flicker keyed to its cell id.
    float nodePhase = uTime * uSpeed * 1.6 + dot(cellId, vec3(1.7, 2.3, 3.1));
    float nodePulse = 0.72 + 0.28 * sin(nodePhase);

    // Fresnel rim (glass edge catching light) + core bleed on facing fragments.
    float facing = max(dot(vNormalV, vViewDir), 0.0);
    float fres = pow(1.0 - facing, 3.0);
    float coreBleed = pow(facing, 3.2) * uCore;

    // Compose emission.
    vec3 traceCol = mix(uBase, uHot, flow * 0.65 + node * 0.5);
    vec3 emission = vec3(0.0);
    emission += edge * traceCol * flow * 1.15;
    emission += node * uHot * 1.7 * nodePulse;
    emission += fres * mix(uBase, uHot, 0.25) * 0.9;
    emission += coreBleed * mix(uBase, uHot, 0.4) * 0.8;

    emission *= uIntensity;

    // Alpha = luminance so dark areas composite transparent (page shows
    // through) and only the glow is opaque — no black disc.
    float lum = clamp(max(emission.r, max(emission.g, emission.b)), 0.0, 1.0);
    gl_FragColor = vec4(emission, lum);
  }
`;

const CORE_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  uniform float uCore;
  uniform vec3  uHot;
  uniform vec3  uBase;
  void main(){
    float facing = max(dot(vNormalV, vViewDir), 0.0);
    float g = pow(facing, 1.6);
    vec3 col = mix(uBase, uHot, 0.55) * g * uCore * 1.9;
    float lum = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    gl_FragColor = vec4(col, lum);
  }
`;

function OrbMesh({ state }: { state: OrbState }) {
  const shellRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);

  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0.5 },
          uSpeed: { value: 0.32 },
          uCore: { value: 0.48 },
          uBase: { value: ELECTRIC.clone() },
          uHot: { value: WHITE_BLUE.clone() },
        },
      }),
    []
  );

  const coreMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: CORE_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uCore: { value: 0.48 },
          uHot: { value: WHITE_BLUE.clone() },
          uBase: { value: ELECTRIC.clone() },
        },
      }),
    []
  );

  // Eased current values.
  const cur = useRef({ intensity: 0.5, speed: 0.32, core: 0.48, hot: WHITE_BLUE.clone() });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = targetsFor(state);
    const k = 1 - Math.pow(0.0015, dt); // critically-ish damped ease

    cur.current.intensity += (t.intensity - cur.current.intensity) * k;
    cur.current.speed += (t.speed - cur.current.speed) * k;

    // Alert breathes the core; others hold steady.
    const now = performance.now() / 1000;
    const breathe = t.breathe > 0 ? 0.78 + 0.22 * Math.sin(now * 2.1) : 1;
    const coreTarget = t.core * breathe;
    cur.current.core += (coreTarget - cur.current.core) * k;
    cur.current.hot.lerp(t.hot, k);

    const u = shellMat.uniforms;
    u.uTime.value = now;
    u.uIntensity.value = cur.current.intensity;
    u.uSpeed.value = cur.current.speed;
    u.uCore.value = cur.current.core;
    (u.uHot.value as THREE.Color).copy(cur.current.hot);

    const cu = coreMat.uniforms;
    cu.uCore.value = cur.current.core;
    (cu.uHot.value as THREE.Color).copy(cur.current.hot);

    if (shellRef.current) {
      shellRef.current.rotation.y += dt * (0.12 + cur.current.speed * 0.22);
      shellRef.current.rotation.x += dt * 0.03;
    }
  });

  return (
    <group>
      <mesh ref={coreRef} material={coreMat}>
        <icosahedronGeometry args={[0.34, 4]} />
      </mesh>
      <mesh ref={shellRef} material={shellMat}>
        <icosahedronGeometry args={[1, 7]} />
      </mesh>
    </group>
  );
}

export default function Orb({
  state = 'idle',
  size = 44,
  active = true,
  halo = true,
}: {
  state?: OrbState;
  size?: number;
  active?: boolean;
  halo?: boolean;
}) {
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {halo && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: '-30%',
            borderRadius: '50%',
            background:
              state === 'alert'
                ? 'radial-gradient(circle, rgba(235,178,78,0.28), transparent 68%)'
                : 'radial-gradient(circle, rgba(37,99,235,0.30), transparent 68%)',
            filter: 'blur(6px)',
            pointerEvents: 'none',
            transition: 'background 600ms ease',
          }}
        />
      )}
      <Canvas
        dpr={[1, 2]}
        frameloop={active ? 'always' : 'never'}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: false }}
        camera={{ position: [0, 0, 4.8], fov: 34 }}
        style={{ position: 'relative', width: size, height: size, display: 'block' }}
      >
        <OrbMesh state={state} />
      </Canvas>
    </div>
  );
}
