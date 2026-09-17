// Nạp xu bằng chuyển khoản + VietQR động.
//
// Luồng: user chọn gói → POST /api/topup tạo đơn `pending` (kèm nội dung chuyển khoản duy nhất)
// → user quét QR VietQR (ảnh từ img.vietqr.io, động theo số tiền + nội dung) → admin duyệt ở
// /admin/topups → server cộng xu trong transaction, đơn thành `confirmed` (hoặc `cancelled`).
import { z } from 'zod';

export const TOPUPS_COLLECTION = 'topups';

export const TOPUP_STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
export type TopupStatus = (typeof TOPUP_STATUSES)[number];

export const TOPUP_STATUS_LABELS: Record<TopupStatus, string> = {
  pending: 'Đang chờ',
  confirmed: 'Đã xác nhận',
  cancelled: 'Đã huỷ',
};

/** Thông tin tài khoản nhận tiền (mặc định như ảnh mẫu; đổi bằng env khi deploy). */
export const TOPUP_BANK = {
  /** Mã ngân hàng theo chuẩn VietQR (Techcombank = TCB). */
  bankId: process.env.NEXT_PUBLIC_TOPUP_BANK_ID || 'TCB',
  bankName: process.env.NEXT_PUBLIC_TOPUP_BANK_NAME || 'Techcombank',
  accountNo: process.env.NEXT_PUBLIC_TOPUP_ACCOUNT_NO || '6162991994',
  accountName: process.env.NEXT_PUBLIC_TOPUP_ACCOUNT_NAME || 'NGUYEN ANH DUY',
  /** Template in của VietQR: compact2 = gọn như ảnh mẫu. */
  template: process.env.NEXT_PUBLIC_TOPUP_QR_TEMPLATE || 'compact2',
} as const;

export interface TopupPackage {
  /** Số tiền user chuyển (VND). */
  vnd: number;
  /** Số xu cộng vào ví khi admin duyệt. */
  coins: number;
}

/** Các gói nạp như ảnh mẫu: 10.000đ = 20 xu, 50.000đ = 100 xu. */
export const TOPUP_PACKAGES: TopupPackage[] = [
  { vnd: 10_000, coins: 20 },
  { vnd: 50_000, coins: 100 },
];

export const createTopupSchema = z.object({
  /** Index trong TOPUP_PACKAGES. */
  packageIndex: z.number().int().min(0).max(TOPUP_PACKAGES.length - 1),
});

export const decideTopupSchema = z.object({
  action: z.enum(['confirm', 'cancel']),
  /** Ghi chú của admin (lưu vào ledger khi confirm). */
  note: z.string().trim().max(200).default(''),
});

export interface TopupOrder {
  id: string;
  uid: string;
  email: string | null;
  displayName: string | null;
  amountVnd: number;
  coins: number;
  /** Nội dung chuyển khoản user phải giữ nguyên để admin đối chiếu, vd. NAPX7K2Q. */
  content: string;
  status: TopupStatus;
  bank: { bankId: string; bankName: string; accountNo: string; accountName: string };
  createdAt: number | null;
  updatedAt: number | null;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
}

export function formatVnd(n: number): string {
  return `${n.toLocaleString('en-US')} đ`;
}

export function formatTopupCoins(n: number): string {
  return `${n.toLocaleString('en-US')} xu`;
}

/** Nội dung chuyển khoản: NAP + 5 ký tự base32 không gây nhầm (không 0/O/1/I). */
export function newTopupContent(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return `NAP${s}`;
}

/**
 * URL ảnh QR động của VietQR (img.vietqr.io, không cần API key):
 * https://img.vietqr.io/image/<BANK>-<STK>-<TEMPLATE>.png?amount=...&addInfo=...&accountName=...
 */
export function vietqrImageUrl(order: Pick<TopupOrder, 'amountVnd' | 'content' | 'bank'>): string {
  const bank = order.bank;
  const q = new URLSearchParams({
    amount: String(order.amountVnd),
    addInfo: order.content,
    accountName: bank.accountName,
  });
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bankId)}-${encodeURIComponent(bank.accountNo)}-${encodeURIComponent(TOPUP_BANK.template)}.png?${q.toString()}`;
}

/** Link trang VietQR in vé (dự phòng khi ảnh lỗi). */
export function vietqrPrintUrl(order: Pick<TopupOrder, 'amountVnd' | 'content' | 'bank'>): string {
  const q = new URLSearchParams({
    bank: order.bank.bankId,
    account: order.bank.accountNo,
    amount: String(order.amountVnd),
    memo: order.content,
  });
  return `https://vietqr.io/?${q.toString()}`;
}
