import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { adminPassword, allowLoginAttempt, checkPassword, createSession, SESSION_COOKIE, SESSION_MAX_AGE } from '@/server/auth';
import { jsonError, readJson } from '@/server/admin';

export async function POST(req: Request) {
  if (!adminPassword()) return jsonError(503, 'Admin đang khóa: hãy đặt biến môi trường ADMIN_PASSWORD');
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
  if (!allowLoginAttempt(ip)) return jsonError(429, 'Thử quá nhiều lần, đợi 1 phút');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = z.object({ password: z.string().max(200) }).safeParse(body);
  if (!parsed.success || !checkPassword(parsed.data.password)) return jsonError(401, 'Sai mật khẩu');
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSession(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return Response.json({ ok: true });
}
