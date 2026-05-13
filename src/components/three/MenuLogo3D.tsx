import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import B3D from './B3D';

// Menu sidebar 3D B mark. Drag to rotate, auto-spin resumes when released.

export default function MenuLogo3D() {
  return (
    <div
      className="w-full h-full"
      style={{ cursor: 'grab' }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLDivElement).style.cursor = 'grabbing';
      }}
      onPointerUp={(e) => {
        (e.currentTarget as HTMLDivElement).style.cursor = 'grab';
      }}
      onPointerLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.cursor = 'grab';
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent', pointerEvents: 'auto' }}
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 4, 6]} intensity={1.1} />
        <pointLight position={[-3, 2, 3]} color="#2563EB" intensity={3} distance={10} />
        <pointLight position={[3, -2, 3]} color="#1E40AF" intensity={2.5} distance={10} />

        <B3D
          spinSpeed={0}
          widthLg={2.2}
          widthMd={2.0}
          widthSm={1.8}
          noBevel
        />

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={1.6}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.6}
          minPolarAngle={Math.PI * 0.25}
          maxPolarAngle={Math.PI * 0.75}
        />
      </Canvas>
    </div>
  );
}
