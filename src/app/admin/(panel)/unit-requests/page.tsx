import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cmsUser } from '@/server/admin';
import { listUnitRequests } from '@/server/unitRequests';

export const dynamic = 'force-dynamic';

export default async function UnitRequestsPage() {
  if (!(await cmsUser())) redirect('/admin/login');
  const requests = await listUnitRequests();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl">Yêu cầu lính mới</h1>
        <Link className="btn" href="/admin/unit-requests">Làm mới</Link>
      </div>
      <p className="text-sm opacity-70">50 yêu cầu gần nhất, mới nhất trước.</p>
      {requests.length === 0 && <p>Chưa có yêu cầu nào.</p>}
      {requests.map((request) => (
        <article key={request.id} className="rounded-xl border-2 border-ink/20 bg-white p-4">
          <p className="font-bold">{request.displayName || request.email || request.uid}</p>
          <p className="break-all text-sm opacity-70">{request.email} · UID: {request.uid}</p>
          {request.createdAt !== null && <p className="text-sm opacity-70">{new Date(request.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>}
          <p className="my-3 whitespace-pre-wrap break-words">{request.description}</p>
          {request.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={request.image} alt="Ảnh tham chiếu lính do người dùng gửi" className="max-h-80 max-w-full rounded-lg object-contain" />
          ) : <p className="text-sm opacity-70">Yêu cầu cũ: ảnh đã gửi qua email, chưa được lưu.</p>}
        </article>
      ))}
    </div>
  );
}
