// User gửi yêu cầu lính mới (ảnh 2D đã nén + mô tả) → email thẳng cho admin.
import { createUnitRequestSchema, UNIT_REQUEST_DAILY_LIMIT } from '@/shared/unitRequest';
import { jsonError, readJson } from '@/server/admin';
import { sendUnitRequest, UnitRequestError } from '@/server/unitRequests';
import { currentUser } from '@/server/users';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError(401, 'Cần đăng nhập để gửi yêu cầu');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = createUnitRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Ảnh hoặc mô tả không hợp lệ');
  try {
    await sendUnitRequest(user.uid, user.email, user.displayName, parsed.data.image, parsed.data.description);
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnitRequestError && e.message === 'limit') return jsonError(429, `Tối đa ${UNIT_REQUEST_DAILY_LIMIT} yêu cầu mỗi 24 giờ`);
    if (e instanceof UnitRequestError) return jsonError(503, 'Máy chủ chưa cấu hình email');
    console.error('unit-requests POST:', e);
    return jsonError(503, 'Chưa gửi được yêu cầu, thử lại sau');
  }
}
