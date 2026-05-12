import { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Edges, Float, Text } from '@react-three/drei';
import * as THREE from 'three';

type LayerKey = 'AGENTS' | 'AUTOMATION' | 'INTEGRATIONS' | 'DATA' | 'INFRASTRUCTURE';

const LAYERS: {
  label: LayerKey;
  y: number;
  color: string;
  opacity: number;
}[] = [
  { label: 'AGENTS',         y:  1.2, color: '#2563EB', opacity: 0.10 },
  { label: 'AUTOMATION',     y:  0.6, color: '#2563EB', opacity: 0.08 },
  { label: 'INTEGRATIONS',   y:  0.0, color: '#1E40AF', opacity: 0.10 },
  { label: 'DATA',           y: -0.6, color: '#1E40AF', opacity: 0.08 },
  { label: 'INFRASTRUCTURE', y: -1.2, color: '#0F2A6B', opacity: 0.12 },
];

const DETAILS: Record<LayerKey, { title: string; tag: string; body: string; bullets: string[] }> = {
  AGENTS: {
    tag: 'Layer 01',
    title: 'AI Agents',
    body: 'Conversational systems that handle real work — qualifying leads, booking meetings, answering questions, following up. Tuned to your business, your tone, your offer.',
    bullets: [
      'Chat agents trained on your offer',
      'Voice agents for inbound + outbound calls',
      'Booking + qualification flows',
      'Multi-turn follow-up sequences',
    ],
  },
  AUTOMATION: {
    tag: 'Layer 02',
    title: 'Automation',
    body: 'Workflows that replace manual operational work. The repetitive tasks your team does daily, running on their own — triggered by events, not by people.',
    bullets: [
      'Event-driven triggers across tools',
      'Document + email automation',
      'Lead routing + scoring',
      'Status sync between systems',
    ],
  },
  INTEGRATIONS: {
    tag: 'Layer 03',
    title: 'Integrations',
    body: 'The wiring that makes your stack act as one system. We connect the tools you already pay for — CRMs, calendars, billing, databases — so they share state instead of silos.',
    bullets: [
      'CRM, calendar, billing connectors',
      'Custom API bridges',
      'Webhook + event pipelines',
      'Bi-directional sync',
    ],
  },
  DATA: {
    tag: 'Layer 04',
    title: 'Data',
    body: 'Pipelines that move, clean, and enrich the information your agents and automations depend on. The data layer that turns scattered records into one source of truth.',
    bullets: [
      'ETL pipelines from any source',
      'Enrichment + deduplication',
      'Real-time + batch processing',
      'Managed databases + warehouses',
    ],
  },
  INFRASTRUCTURE: {
    tag: 'Layer 05',
    title: 'Infrastructure',
    body: 'The foundation everything runs on — fast, observable, and built to outlast a single project. Production-grade hosting, monitoring, and recovery from day one.',
    bullets: [
      'Production-grade hosting + CDN',
      'Auth, logging, error tracking',
      'Scheduled jobs + queue systems',
      'Backups + rollback strategy',
    ],
  },
};

function Layer({
  label,
  y,
  color,
  opacity,
  isActive,
  isDimmed,
  onClick,
}: {
  label: LayerKey;
  y: number;
  color: string;
  opacity: number;
  isActive: boolean;
  isDimmed: boolean;
  onClick: (e: any) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const targetY = useRef(y);
  const targetScale = useRef(1);
  const [hovered, setHovered] = useState(false);

  useFrame(() => {
    if (!groupRef.current) return;
    // Active lifts higher than hover; hover provides subtle lift
    targetY.current = isActive ? y + 0.15 : hovered ? y + 0.06 : y;
    targetScale.current = isActive ? 1.08 : hovered ? 1.04 : 1;
    groupRef.current.position.y += (targetY.current - groupRef.current.position.y) * 0.12;
    groupRef.current.scale.x += (targetScale.current - groupRef.current.scale.x) * 0.12;
    groupRef.current.scale.z += (targetScale.current - groupRef.current.scale.z) * 0.12;
  });

  const dimMul = isDimmed ? 0.35 : 1;
  // Hover brightens the panel fill; active overrides
  const hoverMul = isActive ? 1 : hovered ? 2.4 : 1;
  const edgeColor = isActive ? '#FAF8F3' : hovered ? '#FAF8F3' : '#2563EB';
  const labelColor = isActive ? '#FAF8F3' : hovered ? '#FAF8F3' : '#64748B';

  return (
    <group ref={groupRef} position={[0, y, 0]}>
      {/* Clickable + hoverable panel */}
      <mesh
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
          setHovered(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          document.body.style.cursor = '';
          setHovered(false);
        }}
      >
        <boxGeometry args={[2.4, 0.06, 1.5]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * dimMul * hoverMul} />
        <Edges color={edgeColor} />
      </mesh>

      {/* Hover glow halo — thin oversized box behind panel */}
      {hovered && !isActive && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[2.7, 0.02, 1.8]} />
          <meshBasicMaterial color="#2563EB" transparent opacity={0.12} depthWrite={false} />
        </mesh>
      )}

      <Text
        position={[1.35, 0, 0]}
        fontSize={0.11}
        color={labelColor}
        anchorX="left"
        anchorY="middle"
        letterSpacing={0.15}
      >
        {label}
      </Text>

      <mesh position={[-0.9, 0.04, -0.6]}>
        <sphereGeometry args={[0.04, 12, 12]} />
        <meshBasicMaterial color="#2563EB" transparent opacity={dimMul} />
      </mesh>
      <mesh position={[0.5, 0.04, 0.3]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshBasicMaterial color="#2563EB" transparent opacity={0.7 * dimMul} />
      </mesh>
      <mesh position={[-0.2, 0.04, 0.6]}>
        <sphereGeometry args={[0.025, 12, 12]} />
        <meshBasicMaterial color="#FAF8F3" transparent opacity={0.5 * dimMul} />
      </mesh>
    </group>
  );
}

function Stack({
  activeLayer,
  setActiveLayer,
}: {
  activeLayer: LayerKey | null;
  setActiveLayer: (l: LayerKey | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    // Slow continuous rotation
    groupRef.current.rotation.y += delta * 0.15;
    // Subtle tilt
    groupRef.current.rotation.x = -0.25;
  });

  return (
    <Float speed={1} rotationIntensity={0.08} floatIntensity={0.25}>
      <group ref={groupRef}>
        {LAYERS.map((layer) => (
          <Layer
            key={layer.label}
            label={layer.label}
            y={layer.y}
            color={layer.color}
            opacity={layer.opacity}
            isActive={activeLayer === layer.label}
            isDimmed={activeLayer !== null && activeLayer !== layer.label}
            onClick={(e) => {
              e.stopPropagation();
              setActiveLayer(activeLayer === layer.label ? null : layer.label);
            }}
          />
        ))}

        {[-1.05, 1.05].map((x, i) => (
          <mesh key={i} position={[x, 0, 0]}>
            <boxGeometry args={[0.01, 2.4, 0.01]} />
            <meshBasicMaterial color="#2563EB" transparent opacity={0.3} />
          </mesh>
        ))}
      </group>
    </Float>
  );
}

export default function FounderVisual() {
  const [activeLayer, setActiveLayer] = useState<LayerKey | null>(null);
  const detail = activeLayer ? DETAILS[activeLayer] : null;

  return (
    <div className="relative w-full h-full min-h-[420px]">
      <div className="w-full h-full min-h-[420px]">
        <Canvas
          camera={{ position: [0, 0.5, 6], fov: 45 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.4} />
          <Stack activeLayer={activeLayer} setActiveLayer={setActiveLayer} />
        </Canvas>
      </div>

      {/* Hint */}
      {!detail && (
        <p className="absolute bottom-2 left-0 right-0 text-center font-mono text-[10px] tracking-widest uppercase text-slate/40 pointer-events-none">
          Click a layer
        </p>
      )}

      {/* Detail overlay */}
      {detail && (
        <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
          <div className="relative w-full max-w-md bg-navy/95 backdrop-blur-sm border border-electric/20 p-7 pointer-events-auto">
            <button
              type="button"
              onClick={() => setActiveLayer(null)}
              aria-label="Close"
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-slate hover:text-electric transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>

            <p className="font-mono text-[10px] tracking-widest uppercase text-electric mb-3">
              {detail.tag}
            </p>
            <h4 className="text-2xl font-bold text-cream tracking-tight mb-4">
              {detail.title}
            </h4>
            <p className="text-sm text-slate leading-relaxed mb-5">
              {detail.body}
            </p>
            <ul className="space-y-2">
              {detail.bullets.map((b) => (
                <li key={b} className="flex items-start gap-3 text-xs text-cream/80 leading-relaxed">
                  <span className="mt-[7px] w-3 h-px bg-electric shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
