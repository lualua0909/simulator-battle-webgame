'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { canAccessCms } from '@/shared/users';

// Trang chủ: nút "Xưởng mô hình" chỉ hiện khi đăng nhập bằng admin/root.
export default function WorkshopButton() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!canAccessCms(user)) return null;
  return (
    <Link href="/models" className="btn">
      🧱 Xưởng mô hình
    </Link>
  );
}
