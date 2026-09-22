'use client';

import { Sparkle } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

// Tiêu đề game hiệu ứng khối 3D nổi: chữ xếp lớp text-shadow tạo chiều sâu,
// bóng shine quét ngang, float lên xuống, lấp lánh ✦ và nghiêng theo chuột.
const SPARKS = [
  { left: '2%', top: '12%', size: '1.4rem', delay: '0s', dur: '1.8s' },
  { left: '9%', top: '68%', size: '1rem', delay: '0.5s', dur: '2.2s' },
  { left: '88%', top: '8%', size: '1.6rem', delay: '0.9s', dur: '2s' },
  { left: '95%', top: '62%', size: '1.1rem', delay: '0.2s', dur: '1.6s' },
  { left: '78%', top: '88%', size: '0.9rem', delay: '1.2s', dur: '2.4s' },
  { left: '18%', top: '88%', size: '1rem', delay: '0.7s', dur: '2.1s' },
];

export default function GameTitle() {
  const wrap = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: '0deg', ry: '0deg' });

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: `${(-py * 10).toFixed(2)}deg`, ry: `${(px * 12).toFixed(2)}deg` });
  }, []);

  return (
    <div
      ref={wrap}
      onMouseMove={onMove}
      onMouseLeave={() => setTilt({ rx: '0deg', ry: '0deg' })}
      className="title-scene relative select-none"
      style={{ perspective: '900px' }}
      aria-label="Mini Battle Simulator"
    >
      {/* hào quang sau chữ */}
      <div className="title-glow" aria-hidden />
      {/* tia lấp lánh */}
      {SPARKS.map((s, i) => (
        <span
          key={i}
          aria-hidden
          className="title-spark"
          style={{ left: s.left, top: s.top, fontSize: s.size, animationDelay: s.delay, animationDuration: s.dur }}
        >
          <Sparkle className="fill-current" />
        </span>
      ))}
      <div
        className="title-tilt"
        style={{ transform: `rotateX(${tilt.rx}) rotateY(${tilt.ry})` }}
      >
        <div className="title-pop" style={{ animationDelay: '0.05s' }}>
          <span className="title-3d title-3d-white title-float" data-text="MINI BATTLE">
            MINI BATTLE
          </span>
        </div>
        <div className="title-pop" style={{ animationDelay: '0.22s' }}>
          <span className="title-3d title-3d-gold title-float-delayed" data-text="SIMULATOR">
            SIMULATOR
          </span>
        </div>
      </div>
    </div>
  );
}
