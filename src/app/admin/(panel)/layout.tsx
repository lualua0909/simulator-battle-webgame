import { redirect } from 'next/navigation';
import { AdminNav } from '@/components/admin/AdminChrome';
import { cmsUser } from '@/server/admin';
import { ROLE_LABELS } from '@/shared/users';

export const metadata = { title: 'CMS — Mini Battle Simulator' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await cmsUser();
  if (!user) redirect('/admin/login');
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r-2 border-ink bg-parch p-3">
        <div className="mb-3 font-display text-lg leading-tight">
          Mini Battle
          <br />
          Simulator <span className="text-xs">CMS</span>
        </div>
        <div className="mb-3 truncate rounded-lg bg-white px-2 py-1 text-xs">
          <b>{user.displayName || user.email}</b>
          <br />
          {ROLE_LABELS[user.role]}
        </div>
        <AdminNav />
      </aside>
      <main className="min-w-0 flex-1 p-4">
        {children}
      </main>
    </div>
  );
}
