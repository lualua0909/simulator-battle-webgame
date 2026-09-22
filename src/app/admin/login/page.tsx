'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AuthModal from '@/components/auth/AuthModal';
import { useAuth } from '@/components/auth/AuthProvider';
import { canAccessCms } from '@/shared/users';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const allowed = canAccessCms(user);

  useEffect(() => {
    if (allowed) router.replace('/admin');
  }, [allowed, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#5aa8f0] to-[#f6eedb] p-4">
      {loading || allowed ? (
        <p className="font-bold">Đang kiểm tra phiên…</p>
      ) : user ? (
        <div className="panel flex w-[min(380px,92vw)] flex-col gap-3 p-6">
          <h1 className="font-display text-2xl">Không có quyền</h1>
          <p className="text-sm">
            Tài khoản <b>{user.email}</b> không phải root/admin nên không vào được CMS.
          </p>
          <button className="btn" onClick={() => void signOut()}>
            Đăng nhập tài khoản khác
          </button>
          <Link href="/" className="text-sm underline">
            <ArrowLeft /> Về game
          </Link>
        </div>
      ) : (
        <AuthModal />
      )}
    </main>
  );
}
