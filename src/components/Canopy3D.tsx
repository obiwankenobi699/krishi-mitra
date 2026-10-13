'use client';

/**
 * Interactive 3D canopy terrain (React Three Fiber).
 * Vigor grid -> height + vertex colors, photo drape, isolines, scan intro,
 * hover probe, hotspot pins, height control. Lazy-loaded by the parent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useTexture } from '@react-three/drei';

interface OrbitCameraControls {
  target: THREE.Vector3;
  update: () => void;
}

import { findHotspots, vigorColor, vigorLabel, type Hotspot, type VigorGrid } from '@/lib/canopy';

export type CanopyMode = 'vigor' | 'photo';

export interface HoverPoint {
  x: number;
  y: number;
  v: number;
}

interface Canopy3DProps {
  grid: VigorGrid;
  photoUrl?: string | null;
  mode: CanopyMode;
  heightScale?: number;
  onHoverPoint?: (point: HoverPoint | null) => void;
  onHotspotSelect?: (hotspot: Hotspot | null) => void;
  selectedHotspot?: number | null;
}

const DEEP = '#0f2a1d';
const LIME = '#d9f56b';
const HEIGHT_NORM = 2.2;
/** 1px white PNG data URL: keeps useTexture mounted when no photo is set. */
const BLANK_TEXTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface TerrainUniforms {
  uMix: { value: number };
  uIso: { value: number };
  uScan: { value: number };
  uScanOn: { value: number };
}

function enhanceMaterial(material: THREE.MeshStandardMaterial, uniforms: TerrainUniforms): void {
  material.onBeforeCompile = (shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }) => {
    shader.uniforms.uMix = uniforms.uMix;
    shader.uniforms.uIso = uniforms.uIso;
    shader.uniforms.uScan = uniforms.uScan;
    shader.uniforms.uScanOn = uniforms.uScanOn;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vMixColor;\nvarying vec3 vWPos;\nvarying float vElev;',
      )
      .replace(
        '#include <color_vertex>',
        '#include <color_vertex>\nvMixColor = color;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying vec3 vMixColor;',
          'varying vec3 vWPos;',
          'varying float vElev;',
          'uniform float uMix;',
          'uniform float uIso;',
          'uniform float uScan;',
          'uniform float uScanOn;',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\nvec3 texCol = diffuseColor.rgb;',
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'diffuseColor.rgb = mix(texCol, vMixColor, uMix);',
          'float elevN = clamp(vWPos.y / 2.2, 0.0, 1.0);',
          'float isoBand = smoothstep(0.02, 0.0, abs(fract(elevN * 9.0) - 0.5) - 0.43);',
          'diffuseColor.rgb *= 1.0 - uIso * isoBand * 0.3;',
          'float scanD = (vWPos.x + 5.0) / 10.0 - uScan;',
          'diffuseColor.rgb += uScanOn * vec3(0.85, 0.96, 0.42) * exp(-scanD * scanD * 220.0) * 0.55;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'canopy-terrain-v1';
}

interface TerrainMeshProps {
  grid: VigorGrid;
  photoTexture: THREE.Texture;
  mixTarget: number;
  heightScale: number;
  reducedMotion: boolean;
  onHoverPoint?: (point: HoverPoint | null) => void;
}

function TerrainMesh({
  grid,
  photoTexture,
  mixTarget,
  heightScale,
  reducedMotion,
  onHoverPoint,
}: TerrainMeshProps): React.JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const segX = Math.max(cols - 1, 1);
  const segZ = Math.max(rows - 1, 1);

  const uniforms = useMemo<TerrainUniforms>(
    () => ({ uMix: { value: 1 }, uIso: { value: 0.55 }, uScan: { value: -0.2 }, uScanOn: { value: 0 } }),
    [],
  );

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(10, (10 * rows) / Math.max(cols, 1), segX, segZ);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [rows, cols, segX, segZ]);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: photoTexture,
      roughness: 0.95,
      metalness: 0.0,
    });
    enhanceMaterial(mat, uniforms);
    return mat;
  }, [photoTexture, uniforms]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // Fill height + color buffers in place (vertex row gz == grid row gz).
  useEffect(() => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const gx = i % (segX + 1);
      const gz = Math.floor(i / (segX + 1));
      const v = grid[Math.min(gz, rows - 1)]?.[Math.min(gx, cols - 1)] ?? 0.5;
      pos.setY(i, v * HEIGHT_NORM);
      const [r, g, b] = vigorColor(v);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }, [geometry, grid, rows, cols, segX]);

  const anim = useRef({ rise: reducedMotion ? 1 : 0, scan: -0.2, mix: 1 });
  useFrame((_, delta) => {
    const a = anim.current;
    const dt = Math.min(delta, 0.05);
    if (!reducedMotion && a.rise < 1) {
      a.rise = Math.min(1, a.rise + dt / 1.4);
      const eased = 1 - Math.pow(1 - a.rise, 3);
      if (meshRef.current) meshRef.current.scale.y = Math.max(eased, 0.001) * heightScale;
      uniforms.uScanOn.value = 1;
      a.scan = Math.min(1.2, a.scan + dt / 1.4);
      uniforms.uScan.value = a.scan;
      if (a.rise >= 1) uniforms.uScanOn.value = 0;
    } else if (meshRef.current) {
      meshRef.current.scale.y += (heightScale - meshRef.current.scale.y) * Math.min(1, dt * 6);
    }
    const speed = dt / 0.6;
    if (Math.abs(a.mix - mixTarget) > 0.001) {
      a.mix += Math.sign(mixTarget - a.mix) * Math.min(speed, Math.abs(mixTarget - a.mix));
      uniforms.uMix.value = a.mix;
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      scale={[1, reducedMotion ? heightScale : 0.001, 1]}
      onPointerMove={(event) => {
        const hit = event.uv;
        if (!hit || !onHoverPoint || segX === 0 || rows < 2) return;
        const gx = Math.min(segX, Math.max(0, Math.round(hit.x * segX)));
        const gy = Math.min(rows - 1, Math.max(0, Math.round((1 - hit.y) * (rows - 1))));
        const colsNow = grid[0]?.length ?? 1;
        const sx = Math.min(colsNow - 1, Math.max(0, Math.round((gx / segX) * (colsNow - 1))));
        onHoverPoint({
          x: gx / segX,
          y: gy / Math.max(rows - 1, 1),
          v: grid[gy]?.[sx] ?? 0.5,
        });
      }}
      onPointerOut={() => onHoverPoint?.(null)}
    />
  );
}

interface HotspotPinsProps {
  hotspots: Hotspot[];
  selected: number | null;
  onSelect: (index: number | null) => void;
  heightScale: number;
  grid: VigorGrid;
}

function HotspotPins({ hotspots, selected, onSelect, heightScale, grid }: HotspotPinsProps): React.JSX.Element {
  const groupRefs = useRef<Array<THREE.Group | null>>([]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    groupRefs.current.forEach((group, i) => {
      if (!group) return;
      group.scale.setScalar(selected === i ? 1.5 : 1 + 0.18 * Math.sin(t * 3 + i * 1.7));
    });
  });
  const rows = grid.length;
  const cols = grid[0]?.length ?? 1;
  const aspect = rows / Math.max(cols, 1);
  return (
    <group>
      {hotspots.map((hotspot, i) => {
        const px = (hotspot.x - 0.5) * 10;
        const pz = (hotspot.y - 0.5) * 10 * aspect;
        const gy = Math.min(rows - 1, Math.max(0, Math.round(hotspot.y * (rows - 1))));
        const gx = Math.min(cols - 1, Math.max(0, Math.round(hotspot.x * (cols - 1))));
        const py = (grid[gy]?.[gx] ?? 0.3) * HEIGHT_NORM * heightScale + 0.35;
        const active = selected === i;
        return (
          <group key={`pin-${i}`} position={[px, py, pz]}>
            <group
              ref={(node) => {
                groupRefs.current[i] = node;
              }}
            >
              <mesh
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(active ? null : i);
                }}
                onPointerOver={(event) => {
                  event.stopPropagation();
                  document.body.style.cursor = 'pointer';
                }}
                onPointerOut={() => {
                  document.body.style.cursor = '';
                }}
              >
                <sphereGeometry args={[0.22, 20, 20]} />
                <meshStandardMaterial
                  color={active ? LIME : '#e5482e'}
                  emissive={active ? LIME : '#e5482e'}
                  emissiveIntensity={active ? 1.4 : 0.85}
                  roughness={0.4}
                />
              </mesh>
              <Html center distanceFactor={14} position={[0, 0.65, 0]} zIndexRange={[20, 0]}>
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : i)}
                  className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold shadow-lg transition ${
                    active ? 'bg-lime text-deep' : 'bg-deep/90 text-white'
                  }`}
                  aria-pressed={active}
                  aria-label={`Stressed hotspot ${i + 1}. Activate to focus camera.`}
                >
                  Check here
                </button>
              </Html>
            </group>
          </group>
        );
      })}
    </group>
  );
}

function ControlsRig({
  autoRotate,
  onUserInteract,
  controlsRef,
}: {
  autoRotate: boolean;
  onUserInteract: () => void;
  controlsRef: React.MutableRefObject<OrbitCameraControls | null>;
}): React.JSX.Element {
  return (
    <OrbitControls
      ref={(instance) => {
        controlsRef.current = instance as unknown as OrbitCameraControls | null;
      }}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={7}
      maxDistance={22}
      minPolarAngle={Math.PI / 5}
      maxPolarAngle={Math.PI / 2.15}
      autoRotate={autoRotate}
      autoRotateSpeed={0.7}
      onStart={onUserInteract}
      target={[0, 0.6, 0]}
    />
  );
}

interface CanopySceneProps extends Canopy3DProps {
  textureUrl: string;
  reducedMotion: boolean;
  autoRotate: boolean;
  onUserInteract: () => void;
  controlsRef: React.MutableRefObject<OrbitCameraControls | null>;
}

function CanopyScene({
  grid,
  textureUrl,
  mode,
  heightScale = 1,
  onHoverPoint,
  onHotspotSelect,
  selectedHotspot,
  reducedMotion,
  autoRotate,
  onUserInteract,
  controlsRef,
}: CanopySceneProps): React.JSX.Element {
  const texture = useTexture(textureUrl);
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }, [texture]);

  const hotspots = useMemo(() => findHotspots(grid), [grid]);
  const mixTarget = mode === 'vigor' ? 1 : 0;

  useEffect(() => {
    if (selectedHotspot == null || !hotspots[selectedHotspot] || !controlsRef.current) return;
    const hotspot = hotspots[selectedHotspot];
    const rows = grid.length;
    const cols = grid[0]?.length ?? 1;
    controlsRef.current.target.set(
      (hotspot.x - 0.5) * 10,
      0.6,
      (hotspot.y - 0.5) * 10 * (rows / Math.max(cols, 1)),
    );
    controlsRef.current.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHotspot]);

  return (
    <>
      <color attach="background" args={[DEEP]} />
      <fog attach="fog" args={[DEEP, 18, 34]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 10, 4]} intensity={1.6} color="#fff7e8" />
      <directionalLight position={[-6, 4, -6]} intensity={0.35} color={LIME} />
      <TerrainMesh
        grid={grid}
        photoTexture={texture}
        mixTarget={mixTarget}
        heightScale={heightScale}
        reducedMotion={reducedMotion}
        onHoverPoint={onHoverPoint}
      />
      <HotspotPins
        hotspots={hotspots}
        selected={selectedHotspot ?? null}
        onSelect={(index) => onHotspotSelect?.(index == null ? null : hotspots[index] ?? null)}
        heightScale={heightScale}
        grid={grid}
      />
      <ControlsRig autoRotate={autoRotate && !reducedMotion} onUserInteract={onUserInteract} controlsRef={controlsRef} />
    </>
  );
}

function probeColor(v: number): string {
  const [r, g, b] = vigorColor(v);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export interface ProbeState {
  x: number;
  y: number;
  v: number;
  label: string;
}

export default function Canopy3D(props: Canopy3DProps): React.JSX.Element {
  const { grid, photoUrl, mode, heightScale = 1 } = props;
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef<OrbitCameraControls | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      document.body.style.cursor = '';
    },
    [],
  );

  if (grid.length === 0 || (grid[0]?.length ?? 0) === 0) return <></>;

  const mean =
    grid.reduce((sum, row) => sum + row.reduce((rowSum, v) => rowSum + v, 0), 0) /
    (grid.length * (grid[0]?.length ?? 1));

  const handleInteract = (): void => {
    setAutoRotate(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setAutoRotate(true), 4000);
  };

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-3xl">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 7.5, 13], fov: 42 }}
        gl={{ antialias: true, alpha: false }}
        aria-label="Interactive 3D canopy vigor terrain"
        role="img"
      >
        <CanopyScene
          {...props}
          textureUrl={photoUrl ?? BLANK_TEXTURE}
          heightScale={heightScale}
          reducedMotion={reducedMotion}
          autoRotate={autoRotate}
          onUserInteract={handleInteract}
          controlsRef={controlsRef}
          onHoverPoint={(point) => {
            if (!point) {
              setProbe(null);
            } else {
              setProbe({ ...point, label: vigorLabel(point.v) });
            }
            props.onHoverPoint?.(point);
          }}
          onHotspotSelect={(hotspot) => {
            props.onHotspotSelect?.(hotspot);
          }}
        />
      </Canvas>
      {probe ? (
        <div
          className="pointer-events-none absolute left-3 top-3 rounded-full bg-deep/90 px-3 py-1.5 text-xs font-bold text-white shadow-lg"
          role="status"
        >
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: probeColor(probe.v) }} />
          {probe.label} · {Math.round(probe.v * 100)}/100
        </div>
      ) : null}
      <p className="sr-only">
        {`3D canopy surface. Mean vigor ${Math.round(mean * 100)} of 100. Drag to orbit, scroll to zoom.`}
      </p>
    </div>
  );
}
