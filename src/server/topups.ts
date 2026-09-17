// Đơn nạp xu (chuyển khoản + VietQR) trên Firestore: top-level `topups/{id}`.
// User tạo đơn (pending) → admin duyệt (confirmed, cộng xu trong cùng transaction)
// hoặc huỷ (cancelled, không cộng xu). Client không được đọc/ghi trực tiếp (firestore.rules
// đã chặn, chỉ server qua Admin SDK).
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { creditTopup, EconomyError, emptyPlayer, LEDGER_COLLECTION, PLAYERS_COLLECTION, playerStateSchema } from '@/shared/economy';
import { newTopupContent, TOPUP_BANK, TOPUP_PACKAGES, TOPUP_STATUSES, type TopupOrder, type TopupStatus } from '@/shared/topup';
import { firestore } from './firebase';

const topups = () => firestore().collection('topups');

const millis = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);

function toOrder(id: string, d: FirebaseFirestore.DocumentData): TopupOrder {
  return {
    id,
    uid: String(d.uid ?? ''),
    email: (d.email as string | null) ?? null,
    displayName: (d.displayName as string | null) ?? null,
    amountVnd: Number(d.amountVnd ?? 0),
    coins: Number(d.coins ?? 0),
    content: String(d.content ?? ''),
    status: (TOPUP_STATUSES as readonly string[]).includes(d.status) ? (d.status as TopupStatus) : 'pending',
    bank: {
      bankId: String(d.bank?.bankId ?? TOPUP_BANK.bankId),
      bankName: String(d.bank?.bankName ?? TOPUP_BANK.bankName),
      accountNo: String(d.bank?.accountNo ?? TOPUP_BANK.accountNo),
      accountName: String(d.bank?.accountName ?? TOPUP_BANK.accountName),
    },
    createdAt: millis(d.createdAt),
    updatedAt: millis(d.updatedAt),
    decidedBy: (d.decidedBy as string | null) ?? null,
    decidedAt: millis(d.decidedAt),
    note: (d.note as string | null) ?? null,
  };
}

/** Tạo đơn pending mới cho user. */
export async function createTopup(uid: string, email: string | null, displayName: string | null, packageIndex: number): Promise<TopupOrder> {
  const pkg = TOPUP_PACKAGES[packageIndex];
  if (!pkg) throw new EconomyError('Gói nạp không tồn tại');
  const ref = topups().doc();
  const content = newTopupContent();
  const data = {
    uid,
    email,
    displayName,
    amountVnd: pkg.vnd,
    coins: pkg.coins,
    content,
    status: 'pending' as const,
    bank: { bankId: TOPUP_BANK.bankId, bankName: TOPUP_BANK.bankName, accountNo: TOPUP_BANK.accountNo, accountName: TOPUP_BANK.accountName },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    decidedBy: null,
    decidedAt: null,
    note: null,
  };
  await ref.set(data);
  const snap = await ref.get();
  return toOrder(ref.id, snap.data()!);
}

/** Đơn của một user (mới nhất trước), để hiện lịch sử dưới QR. */
export async function listMyTopups(uid: string, limit = 20): Promise<TopupOrder[]> {
  // Không orderBy trên server để khỏi cần composite index: sắp xếp trong bộ nhớ.
  const snap = await topups().where('uid', '==', uid).limit(200).get();
  return snap.docs
    .map((d) => toOrder(d.id, d.data()))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, limit);
}

/** Đơn mới nhất còn pending của user (để mở lại QR sau khi reload). */
export async function getMyPendingTopup(uid: string): Promise<TopupOrder | null> {
  // Chỉ lọc uid trên server (2 where cần composite index) — lọc pending trong bộ nhớ.
  const snap = await topups().where('uid', '==', uid).limit(200).get();
  const orders = snap.docs
    .map((d) => toOrder(d.id, d.data()))
    .filter((o) => o.status === 'pending')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return orders[0] ?? null;
}

/** CMS: liệt kê đơn theo trạng thái (mặc định pending trước). */
export async function listTopups(status: TopupStatus | 'all' = 'pending', limit = 100): Promise<TopupOrder[]> {
  // where + orderBy cần composite index nên sắp xếp trong bộ nhớ cho chắc chắn.
  const snap = status === 'all' ? await topups().orderBy('createdAt', 'desc').limit(limit).get() : await topups().where('status', '==', status).limit(500).get();
  const orders = snap.docs.map((d) => toOrder(d.id, d.data()));
  if (status !== 'all') orders.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return orders.slice(0, limit);
}

/** CMS: đếm nhanh 3 trạng thái cho tab. */
export async function countTopups(): Promise<Record<TopupStatus, number>> {
  const out = { pending: 0, confirmed: 0, cancelled: 0 } as Record<TopupStatus, number>;
  await Promise.all(
    (Object.keys(out) as TopupStatus[]).map(async (s) => {
      const snap = await topups().where('status', '==', s).count().get();
      out[s] = snap.data().count;
    }),
  );
  return out;
}

/**
 * Duyệt đơn: chỉ pending mới được duyệt; cộng xu + ghi ledger `topup` và đánh dấu
 * confirmed trong CÙNG một transaction (admin bấm 2 lần cũng chỉ cộng 1 lần).
 */
export async function confirmTopup(id: string, adminUid: string, note: string): Promise<TopupOrder> {
  const topupRef = topups().doc(id);
  const result = await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(topupRef);
    if (!snap.exists) throw new EconomyError('Đơn nạp không tồn tại');
    const order = toOrder(snap.id, snap.data()!);
    if (order.status !== 'pending') throw new EconomyError(order.status === 'confirmed' ? 'Đơn này đã được duyệt' : 'Đơn này đã bị huỷ');
    const playerRef = firestore().collection(PLAYERS_COLLECTION).doc(order.uid);
    const playerSnap = await tx.get(playerRef);
    const parsed = playerStateSchema.safeParse(playerSnap.data() ?? {});
    const player = parsed.success ? parsed.data : emptyPlayer();
    if (!parsed.success) throw new EconomyError('Dữ liệu ví không hợp lệ, hãy liên hệ quản trị viên');
    const change = creditTopup(player, order.coins, order.content, order.amountVnd, adminUid);
    tx.set(
      playerRef,
      { ...change.state, createdAt: playerSnap.get('createdAt') ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.create(playerRef.collection(LEDGER_COLLECTION).doc(), { ...JSON.parse(JSON.stringify(change.entry)), at: FieldValue.serverTimestamp() });
    tx.update(topupRef, {
      status: 'confirmed',
      decidedBy: adminUid,
      decidedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      note: note?.trim() ? note.trim().slice(0, 200) : null,
    });
    return order;
  });
  const fresh = await topupRef.get();
  const data = fresh.data();
  return data ? toOrder(id, data) : { ...result, status: 'confirmed' as const, decidedBy: adminUid, note: note?.trim() || null };
}

/** Huỷ đơn: chỉ pending mới được huỷ, không cộng xu. */
export async function cancelTopup(id: string, adminUid: string, note: string): Promise<TopupOrder> {
  const ref = topups().doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new EconomyError('Đơn nạp không tồn tại');
  const order = toOrder(snap.id, snap.data()!);
  if (order.status !== 'pending') throw new EconomyError(order.status === 'confirmed' ? 'Đơn này đã được duyệt, không huỷ được' : 'Đơn này đã bị huỷ');
  await ref.update({
    status: 'cancelled',
    decidedBy: adminUid,
    decidedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    note: note?.trim() ? note.trim().slice(0, 200) : null,
  });
  return { ...order, status: 'cancelled', decidedBy: adminUid, note: note?.trim() || null };
}
