import { useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';

const EXTRUDE_DEPTH = 60;

// Shared 3D B mark — extrudes /b-mark.svg, renders metallic-blue meshes.
// No canvas, no lights — caller supplies the scene wrapper.

type B3DProps = {
  /** World-space Y offset. Default 0. */
  baseY?: number;
  /** Z offset for depth tuning. Default 0. */
  baseZ?: number;
  /** Seconds before the spin starts. Default 0. */
  spinDelay?: number;
  /** Radians per second. Default 0.4. */
  spinSpeed?: number;
  /** Seconds before fade-in begins. Default 0 (visible immediately). */
  fadeInStart?: number;
  /** Fade duration. Default 0 (no fade, instant visible). */
  fadeInDuration?: number;
  /** Target world width per breakpoint. Defaults work for hero. */
  widthLg?: number;
  widthMd?: number;
  widthSm?: number;
  /** Subtle vertical float amplitude. Default 0.05. Set 0 to disable. */
  floatAmp?: number;
  /** Merge all SVG path geometries into one mesh to eliminate z-fighting. Default false. */
  mergeGeometry?: boolean;
  /** Color used when geometries are merged (loses per-path colors). Default brand electric. */
  mergedColor?: string;
  /** Apply polygonOffset to per-mesh materials to fight z-fighting without merging. Default false. */
  perMeshOffset?: boolean;
  /** Disable the extrude bevel — eliminates coplanar slivers near the front face. Default false. */
  noBevel?: boolean;
};

export default function B3D({
  baseY = 0,
  baseZ = 0,
  spinDelay = 0,
  spinSpeed = 0.4,
  fadeInStart = 0,
  fadeInDuration = 0,
  widthLg = 2.6,
  widthMd = 2.2,
  widthSm = 1.7,
  floatAmp = 0.05,
  mergeGeometry = false,
  mergedColor = '#2563EB',
  perMeshOffset = false,
  noBevel = false,
}: B3DProps) {
  const svgData = useLoader(SVGLoader, '/b-mark.svg');
  const groupRef = useRef<THREE.Group>(null);
  const matRefs = useRef<THREE.MeshStandardMaterial[]>([]);
  const mountTime = useRef(performance.now());
  const { size } = useThree();

  const meshes = useMemo(() => {
    const items: { geom: THREE.BufferGeometry; color: string }[] = [];
    const isLight = (hex: string) => {
      const h = hex.replace('#', '');
      if (h.length !== 6) return false;
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return r > 200 && g > 200 && b > 200;
    };

    svgData.paths.forEach((path) => {
      const fill = (path as any).userData?.style?.fill;
      const fillStr =
        typeof fill === 'string'
          ? fill.startsWith('#') ? fill : '#' + fill
          : '#2563EB';
      if (fillStr === 'none' || isLight(fillStr)) return;

      const shapes = SVGLoader.createShapes(path);
      shapes.forEach((shape) => {
        const geom = new THREE.ExtrudeGeometry(shape, {
          depth: EXTRUDE_DEPTH,
          bevelEnabled: !noBevel,
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
  }, [svgData, noBevel]);

  // Front cap — a single flat ShapeGeometry placed in front of the extruded B
  // to cover coplanar z-fighting on the visible front face. Only built when
  // perMeshOffset is enabled (menu only). Preserves per-path colors via vertex colors.
  const frontCap = useMemo(() => {
    if (!perMeshOffset) return null;

    const isLight = (hex: string) => {
      const h = hex.replace('#', '');
      if (h.length !== 6) return false;
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return r > 200 && g > 200 && b > 200;
    };

    const shapeGeoms: THREE.BufferGeometry[] = [];
    svgData.paths.forEach((path) => {
      const fill = (path as any).userData?.style?.fill;
      const fillStr =
        typeof fill === 'string'
          ? fill.startsWith('#') ? fill : '#' + fill
          : '#2563EB';
      if (fillStr === 'none' || isLight(fillStr)) return;

      const shapes = SVGLoader.createShapes(path);
      shapes.forEach((shape) => {
        const geo = new THREE.ShapeGeometry(shape);
        const color = new THREE.Color(fillStr);
        const count = geo.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        shapeGeoms.push(geo);
      });
    });

    if (shapeGeoms.length === 0) return null;
    return mergeGeometries(shapeGeoms, false);
  }, [svgData, perMeshOffset]);

  // When mergeGeometry is true, combine all SVG path geometries into one
  // to eliminate z-fighting between coplanar overlapping paths.
  // Preserves per-path colors via vertex color attribute.
  const mergedGeom = useMemo(() => {
    if (!mergeGeometry || meshes.length === 0) return null;
    const colored = meshes.map((m) => {
      const geo = m.geom.clone();
      const color = new THREE.Color(m.color);
      const count = geo.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geo;
    });
    return mergeGeometries(colored, false);
  }, [meshes, mergeGeometry]);

  const { center, scale } = useMemo(() => {
    const box = new THREE.Box3();
    const temp = new THREE.Mesh();
    meshes.forEach((m) => {
      temp.geometry = m.geom;
      temp.updateMatrixWorld();
      box.expandByObject(temp);
    });
    const c = new THREE.Vector3();
    box.getCenter(c);
    const sv = new THREE.Vector3();
    box.getSize(sv);
    const target =
      size.width >= 1024 ? widthLg : size.width >= 768 ? widthMd : widthSm;
    return { center: c, scale: target / sv.x };
  }, [meshes, size.width, widthLg, widthMd, widthSm]);

  useFrame(() => {
    if (!groupRef.current) return;
    const elapsed = (performance.now() - mountTime.current) / 1000;

    // Fade in
    if (fadeInDuration > 0) {
      const fadeT = Math.min(
        Math.max((elapsed - fadeInStart) / fadeInDuration, 0),
        1
      );
      matRefs.current.forEach((mat) => {
        if (mat) mat.opacity = fadeT;
      });
    }

    // Spin
    if (elapsed > spinDelay) {
      groupRef.current.rotation.y = (elapsed - spinDelay) * spinSpeed;
    }

    // Float
    groupRef.current.position.y = baseY + Math.sin(elapsed * 0.4) * floatAmp;
  });

  const isAnimatedFade = fadeInDuration > 0;

  return (
    <group ref={groupRef} position={[0, baseY, baseZ]} scale={[scale, -scale, scale]}>
      <group position={[-center.x, -center.y, -center.z]}>
        {mergedGeom ? (
          // Single merged mesh — no coplanar surfaces, no z-fighting.
          // Uses vertexColors to preserve the per-path color variation of the original.
          <mesh geometry={mergedGeom}>
            <meshStandardMaterial
              ref={(el) => { if (el) matRefs.current[0] = el; }}
              vertexColors
              color="#FFFFFF"
              emissive={mergedColor}
              emissiveIntensity={0.4}
              metalness={0.75}
              roughness={0.25}
              transparent={isAnimatedFade}
              opacity={isAnimatedFade ? 0 : 1}
            />
          </mesh>
        ) : (
          // Original behavior: one mesh per SVG path (hero uses this)
          <>
            {meshes.map((m, i) => (
              <mesh key={i} geometry={m.geom}>
                <meshStandardMaterial
                  ref={(el) => {
                    if (el) matRefs.current[i] = el;
                  }}
                  color={m.color}
                  emissive={m.color}
                  emissiveIntensity={0.4}
                  metalness={0.75}
                  roughness={0.25}
                  transparent={isAnimatedFade}
                  opacity={isAnimatedFade ? 0 : 1}
                />
              </mesh>
            ))}

            {/* Flat front cap — covers the coplanar front-face z-fighting */}
            {frontCap && (
              <mesh geometry={frontCap} position={[0, 0, EXTRUDE_DEPTH + 0.5]}>
                <meshStandardMaterial
                  vertexColors
                  color="#FFFFFF"
                  emissive={mergedColor}
                  emissiveIntensity={0.4}
                  metalness={0.75}
                  roughness={0.25}
                />
              </mesh>
            )}
          </>
        )}
      </group>
    </group>
  );
}
