'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type RefObject } from 'react';

// SLOT BANNER HERO — khi nào có ảnh chỉ cần thả file vào đúng đường dẫn này rồi
// deploy lại, không cần sửa code:
//   public/images/hero-banner.png   (PNG/JPG/WebP đều được, khuyến nghị ≥1920px rộng)
export const HERO_BANNER_SRC = '/images/hero-banner.png';

// Cách dùng ảnh:
// - 'background' (mặc định): ảnh chỉ làm NỀN, chữ tiêu đề 3D + badge + đồi xanh
//   vẫn đè lên trên như hiện tại.
// - 'replace': ảnh THAY TOÀN BỘ hero (ảnh đã gồm chữ + nền), ẩn hết nội dung cũ.
const HERO_BANNER_MODE: 'background' | 'replace' = 'background';

// Decor nền vẽ bằng CSS hiện tại — chỉ hiện khi chưa có ảnh (fallback).
// Mặt trời (sunRef) lặn xuống sau núi khi cuộn: xem useSunsetParallax.
function HeroDecorations({
  sunRef,
  cloudsRef,
}: {
  sunRef: RefObject<HTMLDivElement | null>;
  cloudsRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      <div className="hero-dots absolute inset-0 z-[1] opacity-60" aria-hidden />
      <div ref={cloudsRef} className="absolute inset-0 z-[2] will-change-transform" aria-hidden>
        <div className="cloud left-0 top-10 h-8 w-40" style={{ animationDuration: '38s' }} />
        <div className="cloud left-0 top-28 h-6 w-28 opacity-80" style={{ animationDuration: '55s', animationDelay: '-20s' }} />
        <div className="cloud left-0 top-52 h-7 w-52 opacity-60" style={{ animationDuration: '70s', animationDelay: '-40s' }} />
      </div>
      <div
        ref={sunRef}
        className="absolute -left-10 top-8 z-[3] h-36 w-36 rounded-full border-4 border-[#2d3232] bg-gradient-to-b from-[#ffe57a] to-[#ff9d2e] shadow-[0_6px_0_0_#2d3232,0_0_60px_rgba(255,200,60,.8)] will-change-transform sm:left-10"
        aria-hidden
      />
    </>
  );
}

function HeroHills({ hillsRef }: { hillsRef: RefObject<SVGSVGElement | null> }) {
  return (
    <svg
      ref={hillsRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[22vh] w-full will-change-transform"
      viewBox="0 0 1200 400"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d="M0 250 L150 170 L300 230 L470 120 L640 220 L820 140 L1000 230 L1200 160 L1200 400 L0 400Z" fill="#8fbf6a" stroke="#2d3232" strokeWidth="8" />
      <path d="M0 310 L200 250 L380 300 L560 240 L760 305 L950 255 L1200 300 L1200 400 L0 400Z" fill="#6fae4b" />
      <path d="M0 360 L300 330 L620 365 L900 335 L1200 360 L1200 400 L0 400Z" fill="#5a9440" />
    </svg>
  );
}

// Hiệu ứng "mặt trời lặn sau núi": gắn trực tiếp vào vị trí cuộn (scroll-linked)
// nên cuộn xuống mặt trời chìm sau dãy núi, kéo lên nó mọc trở lại —
// hoàn toàn thuận nghịch, không phải animation chạy một lần.
// Tốc độ các lớp khác nhau tạo chiều sâu: mặt trời rơi nhanh (~theo kịp
// tốc độ cuộn nên trông như đứng yên để núi dâng lên nuốt nó), núi trôi
// chậm hơn, nội dung bay lên nhanh và mờ dần.
function useSunsetParallax(
  anchorRef: RefObject<HTMLDivElement | null>,
  sunRef: RefObject<HTMLDivElement | null>,
  cloudsRef: RefObject<HTMLDivElement | null>,
  hillsRef: RefObject<SVGSVGElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  resetKey: string,
) {
  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const anchor = anchorRef.current;
      const section = anchor?.closest('section');
      if (!section) return;
      const h = section.offsetHeight || 1;
      // Chỉ parallax trong tầm hero (quá khỏi hero thì giữ nguyên vị trí cuối).
      const s = Math.min(Math.max(window.scrollY, 0), h * 1.1);
      const p = s / h;
      if (sunRef.current) sunRef.current.style.transform = `translate3d(0, ${(s * 1.05).toFixed(1)}px, 0)`;
      if (cloudsRef.current) cloudsRef.current.style.transform = `translate3d(0, ${(s * 0.45).toFixed(1)}px, 0)`;
      if (hillsRef.current) hillsRef.current.style.transform = `translate3d(0, ${(s * 0.2).toFixed(1)}px, 0)`;
      if (contentRef.current) {
        contentRef.current.style.transform = `translate3d(0, ${(s * -0.12).toFixed(1)}px, 0)`;
        contentRef.current.style.opacity = `${Math.max(0, 1 - p * 2.2).toFixed(3)}`;
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [anchorRef, sunRef, cloudsRef, hillsRef, contentRef, enabled, resetKey]);
}

// Bọc trong <section className="relative overflow-hidden ..."> ở page.tsx.
// `children` = nội dung core (badge + tiêu đề + mô tả), luôn render trừ khi
// mode 'replace' và ảnh load thành công. Ảnh lỗi/missing → tự rớt về hero CSS cũ.
export default function HeroBanner({ children, parallax = true }: { children: React.ReactNode; parallax?: boolean }) {
  const [missing, setMissing] = useState(false);
  // Mỏ neo để tìm <section> hero chứa banner (đo chiều cao tính parallax).
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const sunRef = useRef<HTMLDivElement | null>(null);
  const cloudsRef = useRef<HTMLDivElement | null>(null);
  const hillsRef = useRef<SVGSVGElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Decor CSS (có mặt trời) chỉ tồn tại khi ảnh nền missing; chạy lại hook
  // khi `missing` đổi để gán đúng transform cho node vừa mount giữa chừng.
  // Trang dài (vd: nạp xu) truyền parallax={false} để tắt hiệu ứng mờ khi cuộn.
  const parallaxOn = parallax && (HERO_BANNER_MODE !== 'replace' || missing);
  useSunsetParallax(anchorRef, sunRef, cloudsRef, hillsRef, contentRef, parallaxOn, String(missing));

  if (HERO_BANNER_MODE === 'replace') {
    if (!missing) {
      return (
        <Image
          src={HERO_BANNER_SRC}
          alt="Mini Battle Simulator"
          width={1920}
          height={640}
          priority
          className="h-auto w-full"
          onError={() => setMissing(true)}
        />
      );
    }
    return (
      <>
        <div ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden />
        <HeroDecorations sunRef={sunRef} cloudsRef={cloudsRef} />
        <div ref={contentRef} className="relative z-10 will-change-transform">
          {children}
        </div>
        <HeroHills hillsRef={hillsRef} />
      </>
    );
  }

  return (
    <>
      <div ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {!missing && (
        <Image
          src={HERO_BANNER_SRC}
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className="object-cover"
          onError={() => setMissing(true)}
        />
      )}
      {missing && <HeroDecorations sunRef={sunRef} cloudsRef={cloudsRef} />}
      <div ref={contentRef} className="relative z-10 will-change-transform">
        {children}
      </div>
      <HeroHills hillsRef={hillsRef} />
    </>
  );
}
