'use client';

// A treasure chest on stage. Idle: squash-and-stretch hops with a rocking sway. Shake: rattles
// while the server rolls the rewards. Open: the lid bursts back on its hinge, light pours out of
// the box (glow, light column, spinning rays, sparkles) and `onOpened` fires for the reward reveal.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ChestVariant } from '@/shared/schema';
import { CHEST_PRESETS, createChestModel } from '@/game/models/chest';

export type ChestMode = 'idle' | 'shake' | 'open';

interface Props {
  variant: ChestVariant;
  mode: ChestMode;
  /** Once, when the lid is open and the light is at its peak. */
  onOpened?: () => void;
  className?: string;
}

const GLOW: Record<ChestVariant, string> = {
  wooden: '#ffd27a',
  silver: '#c9ecff',
  golden: '#ffe07a',
  giant: '#ffc864',
  magical: '#ff9ce9',
  'super-magical': '#b7a4ff',
};

const SPARKS = 90;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const easeOutBack = (x: number) => {
  const t = clamp01(x) - 1;
  return 1 + 2.4 * t * t * t + 1.4 * t * t;
};

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const softDot = (ctx: CanvasRenderingContext2D, s: number, inner = 0) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, inner, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
};

export default function ChestStage({ variant, mode, onOpened, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ mode, onOpened });
  live.current = { mode, onOpened };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#eef6ff', '#4a3a66', 1.7));
    const key = new THREE.DirectionalLight('#fff1dc', 2.7);
    key.position.set(2.5, 4, 3.5);
    const rim = new THREE.DirectionalLight('#a8d4ff', 1.3);
    rim.position.set(-3, 2.5, -2.5);
    scene.add(key, rim);

    const preset = CHEST_PRESETS[variant];
    const glowColor = new THREE.Color(GLOW[variant]);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    const camHome = new THREE.Vector3(0, 1.75, 4.6 + (preset.width - 1) * 1.6);
    const target = new THREE.Vector3(0, 0.62, 0);

    // Chest inside a rig group: scaling the rig about its origin keeps the feet on the floor.
    const rig = new THREE.Group();
    const yaw = -0.38;
    rig.rotation.y = yaw;
    const chest = createChestModel(preset);
    rig.add(chest);
    scene.add(rig);
    const lid = chest.getObjectByName('lid')!;
    const glowSocket = chest.getObjectByName('socket:glow')!;

    const dotTexture = canvasTexture(128, (ctx, s) => softDot(ctx, s));
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ map: canvasTexture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    scene.add(shadow);

    const additive = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, color: glowColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rays = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      additive(
        canvasTexture(512, (ctx, s) => {
          ctx.translate(s / 2, s / 2);
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
            g.addColorStop(0, 'rgba(255,255,255,0.9)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, s / 2, a - 0.1, a + 0.1);
            ctx.closePath();
            ctx.fill();
          }
        }),
      ),
    );
    rays.position.set(0, 1.1, -0.9);
    scene.add(rays);

    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.38, 3, 24, 1, true),
      additive(
        canvasTexture(64, (ctx, s) => {
          const g = ctx.createLinearGradient(0, 0, 0, s);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(1, 'rgba(255,255,255,0.8)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, s, s);
        }),
      ),
    );
    column.position.set(0, 0.62 + 1.5, 0);
    scene.add(column);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: glowColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(glow);
    const light = new THREE.PointLight(glowColor, 0, 7, 1.6);
    scene.add(light);

    const sparkPos = new Float32Array(SPARKS * 3);
    const sparkVel = new Float32Array(SPARKS * 3);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ map: dotTexture, color: glowColor.clone().lerp(new THREE.Color('#ffffff'), 0.5), size: 0.16, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.frustumCulled = false;
    scene.add(sparks);

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

    const timer = new THREE.Timer();
    let raf = 0;
    let frame = 0;
    let shown: ChestMode | null = null;
    let since = 0;
    let lidFrom = 0;
    let opened = false;
    const glowWorld = new THREE.Vector3();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      timer.update();
      const dt = Math.min(0.05, timer.getDelta());
      const t = timer.getElapsed();
      const { mode: m } = live.current;
      if (m !== shown) {
        shown = m;
        since = t;
        lidFrom = lid.rotation.x;
        if (m === 'open') {
          opened = false;
          chest.updateMatrixWorld(true);
          glowSocket.getWorldPosition(glowWorld);
          for (let i = 0; i < SPARKS; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * 0.35;
            sparkPos.set([glowWorld.x + Math.cos(a) * r, glowWorld.y + 0.2, glowWorld.z + Math.sin(a) * r], i * 3);
            const out = 0.6 + Math.random() * 1.6;
            sparkVel.set([Math.cos(a) * out, 2.5 + Math.random() * 3.5, Math.sin(a) * out], i * 3);
          }
        }
      }
      const u = t - since;
      let hop = 0;
      let squash = 1;
      let lidAngle = 0;
      let shake = 0;
      let flash = 0;
      if (m === 'idle') {
        const c = (t % 1.9) / 1.9;
        if (c < 0.12) squash = 1 - 0.1 * easeOut(c / 0.12);
        else if (c < 0.42) {
          const k = (c - 0.12) / 0.3;
          hop = 0.24 * Math.sin(k * Math.PI * 0.5);
          squash = 1.08 - 0.08 * k;
        } else if (c < 0.6) hop = 0.24 * Math.cos(((c - 0.42) / 0.18) * Math.PI * 0.5);
        else if (c < 0.72) squash = 1 - 0.12 * Math.sin(((c - 0.6) / 0.12) * Math.PI);
        else squash = 1 + 0.03 * Math.sin(((c - 0.72) / 0.28) * Math.PI * 2) * (1 - (c - 0.72) / 0.28);
        lidAngle = c > 0.2 && c < 0.6 ? -0.1 * Math.sin(((c - 0.2) / 0.4) * Math.PI) : 0;
        rig.rotation.z = Math.sin(t * 2.4) * 0.05;
        rig.rotation.y = yaw + Math.sin(t * 0.8) * 0.12;
      } else if (m === 'shake') {
        const k = clamp01(u / 0.25);
        rig.rotation.z = Math.sin(t * 38) * 0.08 * k;
        rig.rotation.y = yaw + Math.sin(t * 17) * 0.05 * k;
        hop = Math.abs(Math.sin(t * 19)) * 0.06 * k;
        squash = 1 + Math.sin(t * 30) * 0.025 * k;
        lidAngle = -Math.abs(Math.sin(t * 23)) * 0.14 * k;
      } else {
        lidAngle = lidFrom + (-1.95 - lidFrom) * easeOutBack(u / 0.5);
        squash = u < 0.1 ? 1 - 0.16 * (u / 0.1) : 0.84 + 0.16 * easeOutBack((u - 0.1) / 0.45);
        rig.rotation.z *= 0.85;
        rig.rotation.y = yaw + Math.sin(t * 0.6) * 0.06;
        shake = Math.max(0, 1 - u / 0.35);
        flash = easeOut(u / 0.4);
        if (!opened && u > 0.55) {
          opened = true;
          live.current.onOpened?.();
        }
      }
      lid.rotation.x = lidAngle;
      rig.position.y = hop;
      rig.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
      shadow.scale.setScalar((1.05 + (preset.width - 1) * 0.8) * (1 - hop * 0.9));

      // Light of an open chest.
      chest.updateMatrixWorld(true);
      glowSocket.getWorldPosition(glowWorld);
      const pulse = 1 + Math.sin(t * 5) * 0.06;
      glow.position.copy(glowWorld).add(new THREE.Vector3(0, 0.25, 0));
      glow.scale.setScalar(2.1 * flash * pulse);
      (glow.material as THREE.SpriteMaterial).opacity = 0.85 * flash;
      light.position.copy(glowWorld).add(new THREE.Vector3(0, 0.5, 0.2));
      light.intensity = 24 * flash * pulse;
      (column.material as THREE.MeshBasicMaterial).opacity = 0.4 * flash;
      column.rotation.y = t * 0.8;
      (rays.material as THREE.MeshBasicMaterial).opacity = 0.75 * flash;
      rays.rotation.z = -t * 0.35;
      if (m === 'open') {
        for (let i = 0; i < SPARKS; i++) {
          sparkVel[i * 3 + 1] -= 3.2 * dt;
          for (let k = 0; k < 3; k++) sparkPos[i * 3 + k] += sparkVel[i * 3 + k] * dt;
        }
        sparkGeo.getAttribute('position').needsUpdate = true;
        sparkMat.opacity = Math.max(0, 1 - Math.max(0, u - 0.9) / 1.2);
      } else sparkMat.opacity = 0;

      camera.position.copy(camHome);
      if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.08 * shake, (Math.random() - 0.5) * 0.08 * shake, 0));
      camera.lookAt(target);
      renderer.render(scene, camera);
      if (++frame === 3) (window as unknown as { __viewerReady?: boolean }).__viewerReady = true;
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
      for (const material of [shadow.material, rays.material, column.material, glow.material, sparkMat]) {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      (window as unknown as { __viewerReady?: boolean }).__viewerReady = false;
    };
  }, [variant]);

  return <div ref={host} className={className ?? 'h-full w-full'} />;
}
