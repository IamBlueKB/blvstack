import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Billboard, Environment, Lightformer, RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';

/*
 * The Stack — one 3D object that travels down the homepage and changes with the story:
 * a blueprint beside "What we build", built phase by phase through Process (audit →
 * design → build → launch), fanned behind the case-study screens, tucked into the
 * founder panel, then lifted off past the final CTA. It relights to match the section
 * it's over (navy, cream, or electric).
 *
 * It lives in a fixed layer between the section backgrounds and the content (index.astro
 * puts every section's content at z-2), so it never covers text. Desktop only: nothing
 * mounts on phones, with reduced motion, or without WebGL.
 */

type Tone = 'navy' | 'cream' | 'electric';

type Params = {
  sx: number; sy: number;   // screen position, px
  width: number;            // stack width, px
  spread: number;           // 0 stacked tight → 1 exploded
  face: number;             // 0 isometric → 1 facing the camera, like frames
  ry: number;               // resting yaw when facing the camera
  spin: number;             // idle rotation speed
  build: number;            // 0 blueprint → 1 built and launched
  labels: number;           // SITES / LEADS / CARE / AI / TECH label opacity
  lift: number;             // px upward
  alpha: number;            // overall visibility
};

type Stop = {
  sel: string;
  nth?: number;
  track?: boolean;          // follow the element on screen; otherwise hold a fixed screen spot
  hold: number;             // fraction of the viewport the stop holds around the element's center
  x?: number; y?: number;   // fixed screen spot (0..1 of the viewport)
  size: number;             // width as a fraction of the viewport (or of the element when tracking)
  spread: number; face: number; ry?: number; spin: number;
  build: number | 'process';
  labels: number; lift: number; alpha: number;
};

// Ordered top to bottom of the page.
const STOPS: Stop[] = [
  { sel: '#hero', hold: 0, x: 0.5, y: 0.2, size: 0.1, spread: 0.2, face: 0, spin: 1, build: 0, labels: 0, lift: 0, alpha: 0 },
  { sel: '#pillars h2', hold: 0.16, x: 0.84, y: 0.6, size: 0.16, spread: 1, face: 0, spin: 0.35, build: 0, labels: 1, lift: 0, alpha: 1 },
  { sel: '#process h2', hold: 0.04, x: 0.8, y: 0.42, size: 0.19, spread: 0.5, face: 0, spin: 0.25, build: 'process', labels: 0, lift: 0, alpha: 1 },
  { sel: '#cases [data-tilt-wrap]', nth: 0, track: true, hold: 0.18, size: 1.04, spread: 0.32, face: 1, ry: -0.09, spin: 0, build: 1, labels: 0, lift: 0, alpha: 1 },
  { sel: '#cases [data-tilt-wrap]', nth: 1, track: true, hold: 0.18, size: 1.04, spread: 0.32, face: 1, ry: 0.09, spin: 0, build: 1, labels: 0, lift: 0, alpha: 1 },
  { sel: '#founder .tone-dark', track: true, hold: 0.05, size: 0.5, spread: 0.25, face: 0, spin: 0.5, build: 1, labels: 0, lift: 0, alpha: 1 },
  { sel: '#cta h2', hold: 0.2, x: 0.84, y: 0.72, size: 0.15, spread: 0.12, face: 0, spin: 0.6, build: 1, labels: 0, lift: 0, alpha: 1 },
  { sel: 'body > footer', hold: 0, x: 0.84, y: 0.72, size: 0.1, spread: 0.06, face: 0, spin: 1.4, build: 1, labels: 0, lift: 900, alpha: 0 },
];

const TONE_SECTIONS: [string, Tone][] = [['#process', 'cream'], ['#founder', 'cream'], ['#cta', 'electric']];

const PALETTE: Record<Tone, { plate: string; edge: string; emissive: string; glow: number; label: string; block: string }> = {
  navy:     { plate: '#13284C', edge: '#60A5FA', emissive: '#2563EB', glow: 0.3,  label: '#FAF8F3', block: '#2563EB' },
  cream:    { plate: '#0A1628', edge: '#2563EB', emissive: '#1E40AF', glow: 0.12, label: '#0A1628', block: '#2563EB' },
  electric: { plate: '#FAF8F3', edge: '#FAF8F3', emissive: '#FFFFFF', glow: 0.04, label: '#FAF8F3', block: '#0A1628' },
};

// Plate geometry (world units at scale 1)
const PW = 2.4, PD = 1.6, PT = 0.12;
const LAYERS = ['SITES', 'LEADS', 'CARE', 'AI', 'TECH'] as const;
const MID = (LAYERS.length - 1) / 2; // plates sit centered around the stack's middle
// A page's worth of modules on each plate: nav bar, hero, side panel, three cards
const BLOCKS = [
  { x: 0, z: -0.58, w: 2.0, d: 0.14 },
  { x: -0.38, z: -0.18, w: 1.2, d: 0.5 },
  { x: 0.62, z: -0.18, w: 0.66, d: 0.5 },
  { x: -0.68, z: 0.42, w: 0.56, d: 0.38 },
  { x: 0, z: 0.42, w: 0.56, d: 0.38 },
  { x: 0.68, z: 0.42, w: 0.56, d: 0.38 },
];

const CAM_Z = 12, FOV = 35;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));

const pointer = { x: 0, y: 0 };

function resolveStop(stop: Stop, el: Element, vw: number, vh: number, build: number) {
  const r = el.getBoundingClientRect();
  const docY = r.top + window.scrollY + r.height / 2;
  const p: Params = {
    sx: stop.track ? r.left + r.width / 2 : (stop.x ?? 0.5) * vw,
    sy: stop.track ? r.top + r.height / 2 : (stop.y ?? 0.5) * vh,
    width: stop.size * (stop.track ? r.width : vw),
    spread: stop.spread, face: stop.face, ry: stop.ry ?? 0, spin: stop.spin,
    build: stop.build === 'process' ? build : stop.build,
    labels: stop.labels, lift: stop.lift, alpha: stop.alpha,
  };
  return { docY, hold: stop.hold * vh, p };
}

function mix(a: Params, b: Params, t: number): Params {
  const out = {} as Params;
  (Object.keys(a) as (keyof Params)[]).forEach((k) => { out[k] = lerp(a[k], b[k], t); });
  return out;
}

/** 0 when the Process headline sits mid-screen, 1 when the top of the card grid does. */
function processBuild(vh: number) {
  const h = document.querySelector('#process h2');
  const g = document.querySelector('#process .grid');
  if (!h || !g) return 1;
  const a = h.getBoundingClientRect(), b = g.getBoundingClientRect();
  const from = a.top + a.height / 2, to = b.top + b.height * 0.2;
  return clamp01((vh / 2 - from) / Math.max(1, to - from));
}

function targetParams(vw: number, vh: number): Params | null {
  const build = processBuild(vh);
  const resolved = STOPS.flatMap((s) => {
    const el = document.querySelectorAll(s.sel)[s.nth ?? 0];
    return el ? [resolveStop(s, el, vw, vh, build)] : [];
  });
  if (!resolved.length) return null;
  const c = window.scrollY + vh / 2;
  if (c <= resolved[0].docY + resolved[0].hold) return resolved[0].p;
  for (let i = 0; i < resolved.length - 1; i++) {
    const a = resolved[i], b = resolved[i + 1];
    const aEnd = a.docY + a.hold, bStart = b.docY - b.hold;
    if (c <= bStart) return mix(a.p, b.p, smooth(clamp01((c - aEnd) / Math.max(1, bStart - aEnd))));
    if (c <= b.docY + b.hold) return b.p;
  }
  return resolved[resolved.length - 1].p;
}

function toneAt(sy: number): Tone {
  for (const [sel, tone] of TONE_SECTIONS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (sy >= r.top && sy <= r.bottom) return tone;
  }
  return 'navy';
}

type LabelMesh = THREE.Mesh & { fillOpacity: number; color: number };

function Stack() {
  const group = useRef<THREE.Group>(null!);
  const labelGroup = useRef<THREE.Group>(null!);
  const labelAnchors = useRef<THREE.Group[]>([]);
  const plateRefs = useRef<THREE.Group[]>([]);
  const cur = useRef<Params>({ sx: 0, sy: 0, width: 0, spread: 0.2, face: 0, ry: 0, spin: 1, build: 0, labels: 0, lift: 0, alpha: 0 });
  const spinAngle = useRef(0.6);
  const tilt = useRef({ x: 0, y: 0 });
  const seeded = useRef(false);

  // One material set, shared by every plate and block, recolored per frame
  const mats = useMemo(() => {
    const plate = new THREE.MeshPhysicalMaterial({ metalness: 0.55, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.25, transparent: true });
    const edge = new THREE.LineBasicMaterial({ transparent: true });
    const block = new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.4, transparent: true });
    const scan = new THREE.MeshBasicMaterial({ color: '#60A5FA', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    return { plate, edge, block, scan };
  }, []);
  const edgeGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(PW, PT, PD)), []);
  // Module blocks pivot at the plate surface, so they grow upward
  const blockGeos = useMemo(() => BLOCKS.map((bl) => new THREE.BoxGeometry(bl.w, 0.05, bl.d).translate(0, 0.025, 0)), []);
  const scanRef = useRef<THREE.Mesh>(null!);
  const labelRefs = useRef<LabelMesh[]>([]);
  const blockRefs = useRef<THREE.Mesh[]>([]);
  const palette = useMemo(() => ({
    plate: new THREE.Color(PALETTE.navy.plate), edge: new THREE.Color(PALETTE.navy.edge),
    emissive: new THREE.Color(PALETTE.navy.emissive), label: new THREE.Color(PALETTE.navy.label),
    block: new THREE.Color(PALETTE.navy.block), glow: PALETTE.navy.glow,
  }), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const vw = state.size.width, vh = state.size.height;
    const target = targetParams(vw, vh);
    if (!target) return;
    const c = cur.current;
    if (!seeded.current) {
      Object.assign(c, target);
      seeded.current = true;
      if (import.meta.env.DEV) (window as unknown as { __stack: Params }).__stack = c; // dev read-out
    }
    // Position locks on fast so the stack stays behind the case-study frames; the rest eases.
    c.sx = damp(c.sx, target.sx, 16, dt); c.sy = damp(c.sy, target.sy, 16, dt);
    (['width', 'spread', 'face', 'ry', 'spin', 'build', 'labels', 'lift', 'alpha'] as const).forEach((k) => { c[k] = damp(c[k], target[k], 7, dt); });

    // Screen → world at z = 0
    const visH = 2 * Math.tan((FOV * Math.PI) / 360) * CAM_Z, visW = visH * (vw / vh);
    const wx = (c.sx / vw - 0.5) * visW;
    const wy = (0.5 - (c.sy - c.lift) / vh) * visH;
    const scale = Math.max(0.0001, ((c.width / vw) * visW / PW) * (0.55 + 0.45 * c.alpha));

    // Relight for the section behind the stack
    const tone = PALETTE[toneAt(c.sy - c.lift)];
    const k = 1 - Math.exp(-5 * dt);
    palette.plate.lerp(tmp.set(tone.plate), k); palette.edge.lerp(tmp.set(tone.edge), k);
    palette.emissive.lerp(tmp.set(tone.emissive), k); palette.label.lerp(tmp.set(tone.label), k);
    palette.block.lerp(tmp.set(tone.block), k); palette.glow = lerp(palette.glow, tone.glow, k);

    // Build phases: audit (outline + scan) → design (faces fill in) → build (modules rise) → launch (glow)
    const b = c.build;
    const faceFill = smooth(clamp01((b - 0.2) / 0.3));
    const blocksT = clamp01((b - 0.45) / 0.3);
    const glow = smooth(clamp01((b - 0.75) / 0.25));
    const t = state.clock.elapsedTime;

    tilt.current.x = damp(tilt.current.x, -pointer.y * 0.12, 4, dt);
    tilt.current.y = damp(tilt.current.y, pointer.x * 0.16, 4, dt);
    spinAngle.current += dt * 0.35 * c.spin;
    const faceYaw = c.ry + Math.round(spinAngle.current / (Math.PI * 2)) * Math.PI * 2;

    const g = group.current;
    g.visible = c.alpha > 0.01;
    g.position.set(wx, wy + Math.sin(t * 1.1) * 0.05 * (1 - c.face) + glow * 0.12 * (1 - c.face), 0);
    g.scale.setScalar(scale);
    g.rotation.set(lerp(0.5, Math.PI / 2, c.face) + tilt.current.x * (1 - c.face * 0.7), lerp(spinAngle.current, faceYaw, c.face) + tilt.current.y * (1 - c.face * 0.7), 0);

    const gap = lerp(0.2, 0.95, c.spread);
    // Facing the camera, the plates fan out behind the frame; the fan mirrors with the panel
    const side = Math.max(-1, Math.min(1, -c.ry / 0.09));
    plateRefs.current.forEach((p, i) => {
      if (!p) return;
      const fan = c.face * (i - MID);
      p.position.set(fan * 0.16 * side, (i - MID) * gap, -fan * 0.12);
    });

    // Labels float over each layer and don't spin with it
    const lg = labelGroup.current;
    lg.position.copy(g.position);
    lg.scale.copy(g.scale);
    lg.rotation.set(g.rotation.x, 0, 0);
    labelAnchors.current.forEach((a, i) => { if (a) a.position.set(0, (i - MID) * gap + 0.3, 0); });

    mats.plate.color.copy(palette.plate);
    mats.plate.emissive.copy(palette.emissive);
    mats.plate.emissiveIntensity = palette.glow * (0.4 + 0.6 * faceFill) + glow * 0.5;
    mats.plate.opacity = c.alpha * (0.07 + 0.93 * faceFill);
    mats.plate.depthWrite = faceFill > 0.95;
    mats.edge.color.copy(palette.edge);
    mats.edge.opacity = c.alpha * (0.95 - 0.45 * faceFill + glow * 0.5);
    mats.block.color.copy(palette.block);
    mats.block.emissive.copy(palette.emissive);
    mats.block.emissiveIntensity = 0.3 + glow * 0.9;
    mats.block.opacity = c.alpha;

    blockRefs.current.forEach((m, j) => {
      if (!m) return;
      const plate = Math.floor(j / BLOCKS.length), idx = j % BLOCKS.length;
      const s = smooth(clamp01(blocksT * 1.8 - idx * 0.12 - plate * 0.18));
      m.scale.set(1, Math.max(0.001, s), 1);
      m.visible = s > 0.002;
    });

    // Audit scan: a light sheet sweeping through the blueprint
    const scanOn = (1 - faceFill) * (1 - c.face) * c.alpha;
    scanRef.current.visible = scanOn > 0.01;
    scanRef.current.position.z = Math.sin(t * 0.9) * PD * 0.55;
    scanRef.current.scale.set(1, gap * (LAYERS.length - 1) + PT * 2, 1);
    mats.scan.opacity = 0.22 * scanOn;

    const labelOpacity = c.labels * c.alpha * (1 - c.face);
    lg.visible = labelOpacity > 0.01;
    labelRefs.current.forEach((l) => {
      if (!l) return;
      l.fillOpacity = labelOpacity;
      l.color = palette.label.getHex();
    });
  });

  return (
    <>
      <group ref={group}>
        {LAYERS.map((name, i) => (
          <group key={name} ref={(el) => { if (el) plateRefs.current[i] = el; }}>
            <RoundedBox args={[PW, PT, PD]} radius={0.05} smoothness={4} material={mats.plate} />
            <lineSegments geometry={edgeGeo} material={mats.edge} />
            {BLOCKS.map((bl, j) => (
              <mesh
                key={j}
                ref={(el) => { if (el) blockRefs.current[i * BLOCKS.length + j] = el; }}
                position={[bl.x, PT / 2, bl.z]}
                geometry={blockGeos[j]}
                material={mats.block}
              />
            ))}
          </group>
        ))}
        <mesh ref={scanRef} material={mats.scan}>
          <planeGeometry args={[PW * 1.08, 1]} />
        </mesh>
      </group>
      <group ref={labelGroup}>
        {LAYERS.map((name, i) => (
          <Billboard key={name} ref={(el) => { if (el) labelAnchors.current[i] = el; }}>
            <Text
              ref={(el: unknown) => { if (el) labelRefs.current[i] = el as LabelMesh; }}
              fontSize={0.2}
              letterSpacing={0.2}
              anchorX="center"
              anchorY="middle"
              fillOpacity={0}
            >
              {`L${i + 1} · ${name}`}
            </Text>
          </Billboard>
        ))}
      </group>
    </>
  );
}

export default function StackStage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const ok = window.matchMedia('(min-width: 768px) and (prefers-reduced-motion: no-preference)').matches;
    let webgl = false;
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      webgl = !!probe;
      probe?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { webgl = false; }
    if (!ok || !webgl) return;

    const onMove = (e: MouseEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', onMove);
    // Mount after first paint, like the hero scene
    let a = 0, b = 0, to = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => { to = window.setTimeout(() => setReady(true), 200); }); });
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(a); cancelAnimationFrame(b); window.clearTimeout(to);
    };
  }, []);

  if (!ready) return null;

  return (
    <div className="stack-stage fixed inset-0 z-[1] pointer-events-none" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, CAM_Z], fov: FOV }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.45} />
        <directionalLight position={[4, 6, 8]} intensity={1.3} />
        <pointLight position={[-5, 2, 5]} color="#2563EB" intensity={40} distance={30} />
        <pointLight position={[5, -3, 5]} color="#60A5FA" intensity={25} distance={30} />
        {/* Studio reflections for the glossy plates, built in-scene (no HDR download) */}
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.5} color="#60A5FA" position={[0, 5, -6]} scale={[12, 2, 1]} />
          <Lightformer form="rect" intensity={1.6} color="#FAF8F3" position={[-6, 0, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
          <Lightformer form="rect" intensity={1.2} color="#2563EB" position={[6, -2, 2]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} />
        </Environment>
        <Stack />
      </Canvas>
    </div>
  );
}
