# Đại Chiến Lô Nhô — battle simulator low-poly trên web

Game mô phỏng đại chiến kiểu *Totally Accurate Battle Simulator*: xếp quân trong vùng triển khai, bấm bắt đầu, xem hai đạo quân lắc lư lao vào nhau, bay người, ragdoll, mưa tên.

- **Next.js 16 (App Router) + Three.js** (engine tự viết, không dùng R3F), **Rapier** cho ragdoll.
- **3 chế độ**: đấu với máy (6 bot có hồ sơ riêng), 2 người 1 máy (xếp quân bí mật), đấu online qua mã phòng (Socket.IO).
- **CMS** tại `/admin`: quản lý lính, vũ khí/sát thương, đạn, particle, asset 3D, bản đồ, bot, cài đặt + bảng khắc chế giáp. SQLite, có preview trực tiếp.
- **Mô hình 3D procedural** theo chuẩn img2threejs, dựng hoàn toàn bằng code: người (nhiều kiểu giáp/mũ/vũ khí), ngựa, voi/ma mút, rồng, đại bàng, máy bắn đá, cây (thông/sồi/bạch dương/khô/cọ/xương rồng), đá, bụi, sông, địa hình.

## Chạy

```bash
npm install
npm run dev            # http://localhost:3000  (Next.js + Socket.IO chung một cổng)
```

Production:

```bash
cp .env.example .env   # đặt ADMIN_PASSWORD
npm run build
npm start
```

| Lệnh | Việc |
| --- | --- |
| `npm test` | test mô phỏng (tất định, bot hợp lệ, seed CMS hợp lệ) |
| `npm run typecheck` | kiểm tra TypeScript |
| `npm run db:reset` | khôi phục dữ liệu CMS mặc định |
| `npm run shots -- models` | chụp ảnh mọi mô hình vào `.shots/models` (cần server đang chạy) |

Biến môi trường: xem `.env.example` (`ADMIN_PASSWORD`, `SESSION_SECRET`, `DATABASE_PATH`, `PORT`).
Khi dev mà không đặt `ADMIN_PASSWORD`, mật khẩu admin là `admin`. Khi production mà thiếu thì admin bị khóa.

> **Triển khai:** chế độ online cần Node server chạy lâu dài (VPS, Railway, Render, Fly.io…) vì dùng WebSocket và SQLite file. Không chạy được trên serverless (Vercel).

## Cách chơi

- Chuột trái: đặt lính · **Shift + kéo**: rải hàng loạt · **Ctrl/⌥ + click** hoặc phím **X**: xóa
- Camera: **lăn / pinch** zoom về phía con trỏ (zoom gần tự hạ góc nhìn) · **chuột phải kéo**: xoay + nghiêng · **chuột giữa** hoặc **Shift + chuột phải** kéo: kéo bản đồ (điểm đất dính theo con trỏ) · ngoài lúc xếp quân, **chuột trái kéo** cũng kéo bản đồ · **WASD / QE**: di chuyển, xoay
- Cinematic: vào xếp quân → bay lướt bản đồ rồi hạ xuống sân mình; bấm bắt đầu → lướt từ quân địch về sau lưng quân mình (trận chờ bay xong); có bên thắng → lướt dọc quân thắng kèm pháo hoa. Click hoặc bấm phím bất kỳ để bỏ qua.
- Trong trận: **Space** tạm dừng, tốc độ 0.25× – 4×

## Kiến trúc

```
server.ts                  custom server: Next.js + Socket.IO
src/shared/                schema zod (nguồn chuẩn cho CMS + game), seed, form CMS, kiểm tra tham chiếu
src/server/                SQLite (better-sqlite3), phiên admin (HMAC cookie), phòng online
src/game/sim/              mô phỏng tất định 30 Hz: địa hình, mục tiêu, di chuyển, va chạm, đòn đánh, đạn, nổ lan
src/game/bot/              bot chọn quân theo chiến thuật + khắc chế + xếp đội hình
src/game/models/           factory mô hình procedural (img2threejs), bake thành part cho instancing
src/game/render/           engine Three.js: lính instanced + animation lò xo, ragdoll Rapier, particle, đạn, camera
src/components/            UI game + CMS
```

**Online không gửi từng khung hình.** Server chỉ kiểm tra đội hình hai bên theo dữ liệu CMS, chọn seed, rồi hai trình duyệt tự chạy cùng một trận. Mô phỏng chỉ dùng `+ - * /`, `Math.sqrt` và PRNG có seed (không dùng `Math.sin/cos/random`), nên kết quả trùng từng bit giữa các trình duyệt. Mỗi giây hai máy gửi checksum; nếu lệch, UI báo desync. Ragdoll, particle và animation chỉ để hiển thị, không ảnh hưởng kết quả.

**Hiển thị:** mỗi (loại lính × bộ phận) là một `InstancedMesh`, nên số draw call không tăng theo quân số. Lính chết được giao cho ragdoll Rapier (khớp cầu tại pivot, vũ khí rơi tự do), sau vài giây đóng băng thành xác. Giới hạn ragdoll/xác chỉnh trong CMS.

## Về mô hình 3D (img2threejs)

Các factory trong `src/game/models/` tuân theo quy ước của skill img2threejs: code-only, `createXModel(params)` trả về `THREE.Group`, tham số tách khỏi đối tượng render, hệ trục +Z trước / +X là bên trái nhân vật, cặp trái/phải dựng bằng phản chiếu, noise có seed, mesh có tên, pivot `userData.part`, socket `userData.socket`, chi tiết `explodeWithParent`. Mọi mô hình tách rời được (explode) và bấm chọn được từng bộ phận ở `/models` và trong CMS.

**Giới hạn:** chưa có ảnh tham chiếu nên đây là bản dựng *reference-free, cách điệu*. Tỉ lệ người lấy từ bảng canon 4 đầu của skill (đầu, cánh tay, cẳng tay, cẳng chân); hông, đùi, vai là lựa chọn thiết kế và được ghi chú trong code. Đã kiểm tra bằng screenshot thật nhiều góc, nhưng **chưa chạy vòng so khớp ảnh có gate của img2threejs** vì vòng đó cần ảnh gốc. Khi có ảnh cho từng đối tượng, chạy pipeline img2threejs cho đối tượng đó rồi thay factory tương ứng.
