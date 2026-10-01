import { redirect } from 'next/navigation';
import { AdminNav } from '@/components/admin/AdminChrome';
import { cmsUser } from '@/server/admin';
import { ROLE_LABELS } from '@/shared/users';

export const metadata = { title: 'CMS' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await cmsUser();
  if (!user) redirect('/admin/login');
  return (
    // Phones/tablets: the sidebar becomes a top bar (its nav a scrolling strip) so content keeps the full width.
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="w-full shrink-0 border-b-2 border-ink bg-parch p-3 md:w-60 md:border-b-0 md:border-r-2">
        <div className="mb-3 font-display text-lg leading-tight">
          Clay Battle <span className="text-xs">CMS</span>
          <br />
          <span className="text-sm">Đại chiến đất sét</span>
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
