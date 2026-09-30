// Yêu cầu lính mới: user gửi 1 ảnh 2D + mô tả → server email thẳng cho admin (ảnh đính kèm).
// Ảnh được client thu nhỏ + nén thành data URL trước khi gửi, nên giới hạn dung lượng chặt.
import { z } from 'zod';

export const UNIT_REQUESTS_COLLECTION = 'unitRequests';

/** Cạnh dài nhất sau khi client thu nhỏ ảnh. */
export const UNIT_REQUEST_IMAGE_MAX_SIDE = 1024;
/** Độ dài tối đa của data URL gửi lên. */
export const UNIT_REQUEST_IMAGE_MAX_CHARS = 700_000;
/** Số yêu cầu tối đa của một user trong 24 giờ (chống spam hộp thư admin). */
export const UNIT_REQUEST_DAILY_LIMIT = 3;

export const createUnitRequestSchema = z.object({
  image: z
    .string()
    .max(UNIT_REQUEST_IMAGE_MAX_CHARS)
    .regex(/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/),
  description: z.string().trim().min(10).max(1000),
});
