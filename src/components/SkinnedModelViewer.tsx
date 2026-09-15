'use client';

// Turntable preview of an uploaded skeletal .glb: the file's own meshes and animation
// clips (idle/walk/run/attack…), not the procedural fallback. Used wherever a skinned
// asset (SKINNED_GLB_KINDS with a glb override) is previewed: the model workshop, the
// admin previews and thumbnails come from the same source the battle renders.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { cloneSkinned, setSkinState, stepSkin, type SkinnedInstance, type SkinState, type SkinTint } from '@/game/models/glbSkinned';
import type { PreviewAnim } from './ModelViewer';

interface Props {
  url: string;
  scale?: number;
  tint?: SkinTint;
  hide?: string[];
  anim?: PreviewAnim;
  /** Fixed camera yaw in degrees; undefined = slow auto-rotate. */
  yaw?: number;
  className?: string;
}

const toSkinState = (anim: PreviewAnim): SkinState => (anim === 'attack' ? 'attack' : anim === 'walk' ? 'walk' : 'idle');

export default function SkinnedModelViewer({ url, scale = 1, tint, hide, anim = 'idle', yaw, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ url, scale, tint, hide, anim, yaw });
  state.current = { url, scale, tint, hide, anim, yaw };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let inst: SkinnedInstance | null = null;
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
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);

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
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Frame the model once its file has loaded (normalised height ≈ 2 m at scale 1).
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
        // Attach as soon as the file has loaded (the effect re-runs per URL).
        const next = cloneSkinned(s.url, s.tint, s.hide);
        if (next) {
          next.group.scale.setScalar(s.scale);
          scene.add(next.group);
          framing = frame(next.group);
          inst = next;
          (window as unknown as { __viewerReady?: boolean }).__viewerReady = true;
        }
      }
      if (inst) {
        if (inst.group.scale.x !== s.scale) {
          inst.group.scale.setScalar(s.scale);
          framing = frame(inst.group);
        }
        setSkinState(inst, toSkinState(s.anim));
        stepSkin(inst, dt);
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

    // The loop below attaches the clone as soon as the file arrives
    // (cloneSkinned starts the load on first call); nothing else to kick off.
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
      (window as unknown as { __viewerReady?: boolean }).__viewerReady = false;
    };
  }, [url]);

  return <div ref={host} className={className ?? 'h-full w-full'} />;
}
