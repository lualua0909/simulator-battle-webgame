import Link from 'next/link';
import { DashboardActions, DefaultsMerge } from '@/components/admin/AdminChrome';
import { COLLECTIONS } from '@/shared/schema';
import { COLLECTION_SPECS } from '@/shared/fields';
import { missingDefaults } from '@/shared/merge';
import { SEED } from '@/shared/seed';
import { findRefIssues } from '@/shared/validate';
import { contentVersion, getContent } from '@/server/content';

export default async function Dashboard() {
  const content = await getContent();
  const issues = findRefIssues(content);
  const missing = missingDefaults(content, SEED);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-2xl">Tổng quan</h1>
        <span className="font-mono text-xs opacity-60">phiên bản nội dung {contentVersion(content)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {COLLECTIONS.map((c) => (
          <Link key={c} href={`/admin/c/${c}`} className="panel p-3 transition hover:-translate-y-0.5">
            <div className="text-2xl">{COLLECTION_SPECS[c].icon}</div>
            <div className="font-display text-2xl">{content[c].length}</div>
            <div className="text-sm font-bold">{COLLECTION_SPECS[c].label}</div>
          </Link>
        ))}
      </div>
      <section className="panel p-4">
        <h2 className="mb-2 font-display text-sm">Kiểm tra toàn vẹn dữ liệu</h2>
        {issues.length === 0 ? (
          <p className="text-sm text-green-700">✓ Mọi tham chiếu đều hợp lệ.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm text-red-team">
            {issues.map((i, k) => (
              <li key={k}>
                {i.source}/{i.id}: {i.message}
              </li>
            ))}
          </ul>
        )}
      </section>
      {(missing.docs.length > 0 || missing.unskilled.length > 0 || missing.unpriced.length > 0 || missing.settings.length > 0) && (
        <section className="panel p-4">
          <h2 className="mb-2 font-display text-sm">Nội dung mặc định mới chưa có trong dữ liệu</h2>
          <DefaultsMerge missing={missing} />
        </section>
      )}
      <section className="panel p-4">
        <h2 className="mb-2 font-display text-sm">Sao lưu & khôi phục</h2>
        <DashboardActions />
      </section>
    </div>
  );
}
