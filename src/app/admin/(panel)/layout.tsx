import { redirect } from 'next/navigation';
import { AdminNav } from '@/components/admin/AdminChrome';
import { isAdmin } from '@/server/admin';
import { usingDefaultPassword } from '@/server/auth';

export const metadata = { title: 'CMS — Đại Chiến Lô Nhô' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect('/admin/login');
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r-2 border-ink bg-parch p-3">
        <div className="mb-3 font-display text-lg leading-tight">
          Đại Chiến
          <br />
          Lô Nhô <span className="text-xs">CMS</span>
        </div>
        <AdminNav />
      </aside>
      <main className="min-w-0 flex-1 p-4">
        {usingDefaultPassword() && (
          <div className="mb-3 rounded-lg border-2 border-amber-600 bg-amber-50 px-3 py-2 text-sm">
            Đang dùng mật khẩu mặc định <b>admin</b> (chế độ dev). Đặt <code>ADMIN_PASSWORD</code> trong <code>.env</code> trước khi triển khai.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
