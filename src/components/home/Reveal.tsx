'use client';

import { useEffect, useRef, useState } from 'react';

type RevealVariant = 'up' | 'left' | 'right' | 'zoom' | 'fade';

type RevealProps = {
  children: React.ReactNode;
  variant?: RevealVariant;
  /** Độ trễ stagger (ms), dùng để nối tiếp các card trong cùng 1 grid */
  delay?: number;
  className?: string;
  as?: 'div' | 'span';
};

// Bọc khối nội dung để tự hiện animation khi cuộn tới (IntersectionObserver,
// chỉ chạy 1 lần). Dùng ở trang chủ: <Reveal delay={100}>...</Reveal>.
export default function Reveal({ children, variant = 'up', delay = 0, className = '', as = 'div' }: RevealProps) {
  const ref = useRef<HTMLDivElement | HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Không có IntersectionObserver (trình duyệt rất cũ) → hiện luôn.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls = `reveal reveal-${variant}${visible ? ' is-visible' : ''}${className ? ` ${className}` : ''}`;
  const style = delay > 0 ? { transitionDelay: `${delay}ms` } : undefined;

  if (as === 'span') {
    return (
      <span ref={ref as React.Ref<HTMLSpanElement>} className={cls} style={style}>
        {children}
      </span>
    );
  }
  return (
    <div ref={ref as React.Ref<HTMLDivElement>} className={cls} style={style}>
      {children}
    </div>
  );
}
