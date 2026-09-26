'use client';

// Turntable preview of the barracks (nhà lính) fixed GLB: the file's own meshes plus
// its Door_OpenClose action. The old procedural barracks was deleted, so every preview
// resolves here instead of the ModelViewer fallback.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BARRACKS_GLB_URL, cloneBarracks, playBarracksDoor, stepBarracks, type BarracksInstance } from '@/game/models/barracksGlb';

interface Props {
  scale?: number;
  /** Fixed camera yaw in degrees; undefined = slow auto-rotate. */
  yaw?: number;
  className?: string;
}

export default function BarracksViewer({ scale = 3.3, yaw, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const instRef = useRef<BarracksInstance | null>(null);
  const state = useRef({ scale, yaw });
  state.current = { scale, yaw };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let inst: BarracksInstance | null = null;
    let raf = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfeaf2');
    scene.add(new THREE.HemisphereLight('#eaf4ff', '#6b5a3a', 1.6));
    const sun = new THREE.DirectionalLight('#fff4de', 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun, sun.target);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshStandardMaterial({ color: '#9cc47a', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    let orbitYaw = 35;
    let orbitPitch = 18;
    let zoom = 1;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      orbitYaw -= (e.clientX - lastX) * 0.4;
      orbitPitch = Math.max(-5, Math.min(80, orbitPitch + (e.clientY - lastY) * 0.3));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.max(0.4, Math.min(3, zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const w = el.clientWidth || 300;
      const h = el.clientHeight || 300;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.fov = camera.aspect < 0.8 ? 50 : camera.aspect < 1 ? 42 : 35;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const frame = (group: THREE.Group) => {
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.5 + 0.2;
      const shadowCam = sun.shadow.camera;
      shadowCam.left = shadowCam.bottom = -radius * 2;
      shadowCam.right = shadowCam.top = radius * 2;
      shadowCam.far = radius * 10;
      sun.position.set(radius * 2, radius * 4, radius * 3).add(center);
      sun.target.position.copy(center);
      shadowCam.updateProjectionMatrix();
      ground.scale.setScalar(Math.max(1, radius * 1.2));
      return { center, radius };
    };
    let framing: { center: THREE.Vector3; radius: number } | null = null;

    const timer = new THREE.Timer();
    const loop = () => {
      if (dead) return;
      raf = requestAnimationFrame(loop);
      timer.update();
      const dt = Math.min(0.05, timer.getDelta());
      const s = state.current;
      if (!inst) {
        const next = cloneBarracks(BARRACKS_GLB_URL);
        if (next) {
          next.group.scale.setScalar(s.scale);
          scene.add(next.group);
          framing = frame(next.group);
          inst = next;
          instRef.current = next;
          playBarracksDoor(next);
          (window as unknown as { __viewerReady?: boolean }).__viewerReady = true;
        }
      }
      if (inst) {
        if (inst.group.scale.x !== s.scale) {
          inst.group.scale.setScalar(s.scale);
          framing = frame(inst.group);
        }
        stepBarracks(inst, dt);
      }
      if (!framing) {
        renderer.render(scene, camera);
        return;
      }
      const { center, radius } = framing;
      if (s.yaw === undefined && !dragging) orbitYaw += dt * 12;
      const yawDeg = s.yaw ?? orbitYaw;
      const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.25 * zoom;
      const yr = (yawDeg * Math.PI) / 180;
      const pr = (orbitPitch * Math.PI) / 180;
      camera.position.set(center.x + Math.sin(yr) * Math.cos(pr) * dist, center.y + Math.sin(pr) * dist, center.z + Math.cos(yr) * Math.cos(pr) * dist);
      camera.lookAt(center);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      renderer.dispose();
      renderer.domElement.remove();
      ground.geometry.dispose();
      instRef.current = null;
      (window as unknown as { __viewerReady?: boolean }).__viewerReady = false;
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className={className ?? 'h-full min-h-[200px] w-full touch-none'} />
      <button
        type="button"
        className="btn absolute right-2 top-2 px-2 py-0.5 text-xs"
        onClick={() => {
          if (instRef.current) playBarracksDoor(instRef.current);
        }}
        title="Chạy action mở cửa của nhà lính"
      >
        Mở cửa
      </button>
    </div>
  );
}
