'use client';

// Turntable preview of a baked model template: live procedural animation,
// explode view and click-to-identify parts (img2threejs assembly contract).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { WeaponDef } from '@/shared/schema';
import type { ModelTemplate } from '@/game/models/bake';
import { attackStyleFor, Poser } from '@/game/render/animate';

export type PreviewAnim = 'idle' | 'walk' | 'attack';

interface Props {
  template: ModelTemplate | null;
  weapon?: WeaponDef;
  anim?: PreviewAnim;
  /** Fixed camera yaw in degrees; undefined = slow auto-rotate. */
  yaw?: number;
  explode?: boolean;
  onPick?: (part: string | null) => void;
  className?: string;
}

const partMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
const smoothPartMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });

export default function ModelViewer({ template, weapon, anim = 'idle', yaw, explode = false, onPick, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ anim, yaw, explode, onPick, weapon });
  state.current = { anim, yaw, explode, onPick, weapon };

  useEffect(() => {
    const el = host.current;
    if (!el || !template) return;
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

    const bounds = template.bounds.clone();
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 + 0.2;
    const shadowCam = sun.shadow.camera;
    shadowCam.left = shadowCam.bottom = -radius * 2;
    shadowCam.right = shadowCam.top = radius * 2;
    shadowCam.far = radius * 10;
    sun.position.set(radius * 2, radius * 4, radius * 3).add(center);
    sun.target.position.copy(center);
    shadowCam.updateProjectionMatrix();

    const ground = new THREE.Mesh(new THREE.CircleGeometry(radius * 2.4, 32), new THREE.MeshStandardMaterial({ color: '#9cc47a', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, radius * 40);
    const meshes: THREE.Mesh[] = template.parts.map((p) => {
      const m = new THREE.Mesh(p.geometry ?? new THREE.BufferGeometry(), template.smooth ? smoothPartMaterial : partMaterial);
      m.visible = !!p.geometry;
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      m.userData.partName = p.name;
      scene.add(m);
      return m;
    });
    const poses = template.parts.map(() => new THREE.Matrix4());
    const poser = new Poser(template, attackStyleFor(template, state.current.weapon));

    let orbitYaw = 35;
    let orbitPitch = 18;
    let zoom = 1;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      orbitYaw -= (e.clientX - lastX) * 0.4;
      orbitPitch = Math.max(-5, Math.min(80, orbitPitch + (e.clientY - lastY) * 0.3));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const raycaster = new THREE.Raycaster();
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (moved > 4 || !state.current.onPick) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(meshes.filter((m) => m.visible))[0];
      state.current.onPick(hit ? (hit.object.userData.partName as string) : null);
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
      // Portrait hẹp (mobile): mở rộng fov để model không bị cắt 2 bên.
      camera.fov = camera.aspect < 0.8 ? 50 : camera.aspect < 1 ? 42 : 35;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const timer = new THREE.Timer();
    let phase = 0;
    let frame = 0;
    let raf = 0;
    const tmp = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      timer.update();
      const dt = Math.min(0.05, timer.getDelta());
      const time = timer.getElapsed();
      const s = state.current;
      const speed = s.anim === 'walk' ? 3.5 : 0;
      phase += speed * dt * 2.2;
      const cycle = (time % 1.6) / 1.6;
      const attack = s.anim === 'attack' ? (cycle < 0.5 ? cycle * 2 : 1 + (cycle - 0.5) * 2) : -1;
      poser.compute({ time, speed, phase, attack, airborne: false, stunned: false, leanX: 0, leanZ: 0, seed: 0.3, refSpeed: 3.5 }, poses);
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i];
        m.matrix.copy(poses[i]);
        if (s.explode) {
          tmp.setFromMatrixPosition(poses[i]).sub(center);
          const push = tmp.clone().multiplyScalar(0.9).add(tmp.clone().normalize().multiplyScalar(radius * 0.15));
          m.matrix.elements[12] += push.x;
          m.matrix.elements[13] += push.y;
          m.matrix.elements[14] += push.z;
        }
      }
      if (s.yaw === undefined && !dragging) orbitYaw += dt * 12;
      const yawDeg = s.yaw ?? orbitYaw;
      const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.25 * zoom;
      const yr = (yawDeg * Math.PI) / 180;
      const pr = (orbitPitch * Math.PI) / 180;
      camera.position.set(center.x + Math.sin(yr) * Math.cos(pr) * dist, center.y + Math.sin(pr) * dist, center.z + Math.cos(yr) * Math.cos(pr) * dist);
      camera.lookAt(center);
      renderer.render(scene, camera);
      if (++frame === 3) (window as unknown as { __viewerReady?: boolean }).__viewerReady = true;
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      renderer.dispose();
      renderer.domElement.remove();
      ground.geometry.dispose();
      (window as unknown as { __viewerReady?: boolean }).__viewerReady = false;
    };
  }, [template]);

  return <div ref={host} className={className ?? 'h-full min-h-[200px] w-full touch-none'} />;
}
