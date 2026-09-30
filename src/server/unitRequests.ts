// Yêu cầu lính mới: email cho admin qua SMTP (nodemailer), kèm log Firestore `unitRequests/{id}`
// (chỉ dùng để giới hạn số yêu cầu/ngày; firestore.rules chặn client).
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import { UNIT_REQUEST_DAILY_LIMIT, UNIT_REQUESTS_COLLECTION } from '@/shared/unitRequest';
import { firestore } from './firebase';

export class UnitRequestError extends Error {}

/** Hộp thư nhận yêu cầu; đổi bằng env UNIT_REQUEST_EMAIL. */
const ADMIN_EMAIL = process.env.UNIT_REQUEST_EMAIL || 'nad.duyna@gmail.com';

const requests = () => firestore().collection(UNIT_REQUESTS_COLLECTION);

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function transport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT || 465);
  return nodemailer.createTransport({ host: SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
}

/** Gửi email yêu cầu cho admin rồi ghi log. Ném UnitRequestError khi vượt giới hạn hoặc chưa cấu hình SMTP. */
export async function sendUnitRequest(uid: string, email: string | null, displayName: string | null, image: string, description: string): Promise<void> {
  const mailer = transport();
  if (!mailer) throw new UnitRequestError('smtp');

  // Chỉ lọc uid trên server (2 where cần composite index) — đếm 24h trong bộ nhớ.
  const since = Date.now() - 24 * 3600 * 1000;
  const mine = await requests().where('uid', '==', uid).select('createdAt').limit(200).get();
  const recent = mine.docs.filter((d) => {
    const at = d.get('createdAt');
    return at instanceof Timestamp && at.toMillis() >= since;
  }).length;
  if (recent >= UNIT_REQUEST_DAILY_LIMIT) throw new UnitRequestError('limit');

  const [, mime, b64] = /^data:(image\/\w+);base64,(.+)$/.exec(image)!;
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  const who = displayName || email || uid;
  await mailer.sendMail({
    from: `Clay Battle <${process.env.SMTP_USER}>`,
    to: ADMIN_EMAIL,
    replyTo: email ?? undefined,
    subject: `[Clay Battle] Yêu cầu lính mới từ ${who}`,
    text: `Người gửi: ${who}\nEmail: ${email ?? '—'}\nUID: ${uid}\n\nMô tả:\n${description}`,
    html: `<p><b>Người gửi:</b> ${escapeHtml(who)}<br><b>Email:</b> ${escapeHtml(email ?? '—')}<br><b>UID:</b> ${escapeHtml(uid)}</p>
<p><b>Mô tả:</b></p><p style="white-space:pre-wrap">${escapeHtml(description)}</p>
<p><img src="cid:unit-ref" style="max-width:100%"></p>`,
    attachments: [{ filename: `unit-request.${ext}`, content: Buffer.from(b64, 'base64'), contentType: mime, cid: 'unit-ref' }],
  });

  await requests().add({ uid, email, displayName, description, createdAt: FieldValue.serverTimestamp() });
}
