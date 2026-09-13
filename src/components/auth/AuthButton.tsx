'use client';

import Link from 'next/link';
import { canAccessCms } from '@/shared/users';
import { useAuth } from './AuthProvider';

/** Sign-in button, or the signed-in user with CMS link (root/admin) and sign-out. */
export default function AuthButton() {
  const { user, loading, openAuth, signOut } = useAuth();
  if (loading) return <span className="btn opacity-60">…</span>;
  if (!user) {
    return (
      <button className="btn btn-gold" onClick={() => openAuth('signin')}>
        👤 Đăng nhập
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="btn pointer-events-none max-w-[60vw] truncate">👤 {user.displayName || user.email}</span>
      {canAccessCms(user) && (
        <Link href="/admin" className="btn">
          🛠 CMS quản trị
        </Link>
      )}
      <button className="btn" onClick={() => void signOut()}>
        ⎋ Đăng xuất
      </button>
    </div>
  );
}
