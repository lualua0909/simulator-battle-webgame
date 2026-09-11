'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#5aa8f0] to-[#f6eedb] p-4">
      <form
        className="panel flex w-[min(360px,92vw)] flex-col gap-3 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
          setBusy(false);
          if (res.ok) router.push('/admin');
          else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Đăng nhập thất bại');
        }}
      >
        <h1 className="font-display text-2xl">CMS quản trị</h1>
        <label className="flex flex-col gap-1 text-sm font-bold">
          Mật khẩu
          <input className="field" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="text-sm font-bold text-red-team">{error}</p>}
        <button className="btn btn-gold" disabled={busy || !password}>
          {busy ? 'Đang vào…' : 'Đăng nhập'}
        </button>
        <p className="text-xs opacity-60">Mật khẩu lấy từ biến môi trường ADMIN_PASSWORD (dev để trống thì là “admin”).</p>
        <Link href="/" className="text-sm underline">
          ← Về game
        </Link>
      </form>
    </main>
  );
}
