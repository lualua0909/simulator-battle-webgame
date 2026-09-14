# Đại Chiến Lô Nhô — battle simulator low-poly trên web

Game mô phỏng đại chiến kiểu *Totally Accurate Battle Simulator*: xếp quân trong vùng triển khai, bấm bắt đầu, xem hai đạo quân lắc lư lao vào nhau, bay người, ragdoll, mưa tên.

- **Next.js 16 (App Router) + Three.js** (engine tự viết, không dùng R3F), **Rapier** cho ragdoll.
- **3 chế độ**: đấu với máy (6 bot có hồ sơ riêng), 2 người 1 máy (xếp quân bí mật), đấu online qua mã phòng (Socket.IO).
- **CMS** tại `/admin`: quản lý lính, vũ khí/sát thương, đạn, particle, asset 3D, bản đồ, bot, cài đặt + bảng khắc chế giáp. Lưu trên Firestore, có preview trực tiếp.
- **Xưởng img2threejs** tại `/admin/studio`: tạo model 3D từ ảnh mẫu + mô tả bằng Claude, xuất TypeScript/GLB/OBJ/STL/PLY/USDZ hoặc thay model nhân vật trong game.
- **Mô hình 3D procedural** theo chuẩn img2threejs, dựng hoàn toàn bằng code: người (nhiều kiểu giáp/mũ/vũ khí), ngựa, voi/ma mút, rồng, đại bàng, máy bắn đá, cây (thông/sồi/bạch dương/khô/cọ/xương rồng), đá, bụi, sông, địa hình.

## Chạy

```bash
npm install
npm run dev            # http://localhost:3000  (Next.js + Socket.IO chung một cổng)
```

Production:

```bash
cp .env.example .env   # đặt FIREBASE_SERVICE_ACCOUNT, FIREBASE_ROOT_EMAILS
npm run build
npm start
```

| Lệnh | Việc |
| --- | --- |
| `npm test` | test mô phỏng (tất định, bot hợp lệ, seed CMS hợp lệ) + sculpt spec (gate, phản chiếu, file TS xuất ra khớp model) |
| `npm run typecheck` | kiểm tra TypeScript |
| `npm run db:reset` | ghi đè nội dung CMS trên Firestore bằng dữ liệu mặc định |
| `npm run shots -- models` | chụp ảnh mọi mô hình vào `.shots/models` (cần server đang chạy) |

Biến môi trường: xem `.env.example` (`FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_ROOT_EMAILS`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY`, `DATABASE_PATH`, `PORT`, `ANTHROPIC_API_KEY`).

Tài khoản: Firebase Auth (email/mật khẩu + Google). Hồ sơ lưu ở Firestore `users/{uid}` (`role`: 0 root, 1 admin, 2 user; `fcmTokens`). Chỉ root/admin vào `/admin`; quản lý user ở `/admin/users`. Root đầu tiên: thêm email vào `FIREBASE_ROOT_EMAILS` rồi đăng nhập bằng Google. Firebase Console cần bật provider Email/Password + Google, và triển khai `firestore.rules` (client chỉ đọc hồ sơ của mình, mọi ghi đi qua server).

> **Triển khai:** chế độ online cần Node server chạy lâu dài (VPS, Railway, Render, Fly.io…) vì dùng WebSocket và SQLite file. Không chạy được trên serverless (Vercel).

## Cách chơi

- Chuột trái: đặt lính · **Shift + kéo**: rải hàng loạt · **Ctrl/⌥ + click** hoặc phím **X**: xóa
- Camera: **lăn / pinch** zoom về phía con trỏ (zoom gần tự hạ góc nhìn) · **chuột phải kéo**: xoay + nghiêng · **chuột giữa** hoặc **Shift + chuột phải** kéo: kéo bản đồ (điểm đất dính theo con trỏ) · ngoài lúc xếp quân, **chuột trái kéo** cũng kéo bản đồ · **WASD / QE**: di chuyển, xoay
- Cinematic: vào xếp quân → bay lướt bản đồ rồi hạ xuống sân mình; bấm bắt đầu → lướt từ quân địch về sau lưng quân mình (trận chờ bay xong); có bên thắng → lướt dọc quân thắng kèm pháo hoa. Click hoặc bấm phím bất kỳ để bỏ qua.
- Xếp quân: **Ctrl/⌘ + Z** hoàn tác (mỗi lần click/kéo/ngẫu nhiên/xóa hết là một bước)
- Trong trận: **Space** tạm dừng, tốc độ 0.25× – 4× (phím **1–4**)

## Kiến trúc

```
server.ts                  custom server: Next.js + Socket.IO
src/shared/                schema zod (nguồn chuẩn cho CMS + game), seed, form CMS, kiểm tra tham chiếu
src/server/                nội dung CMS trên Firestore (bản sao sống trong RAM), SQLite cho job Xưởng, phiên đăng nhập, phòng online
src/game/sim/              mô phỏng tất định 30 Hz: địa hình, mục tiêu, di chuyển, va chạm, đòn đánh, đạn, nổ lan
src/game/bot/              bot chọn quân theo chiến thuật + khắc chế + xếp đội hình
src/game/models/           factory mô hình procedural (img2threejs), bake thành part cho instancing
src/game/sculpt/           sculpt spec → Three.js (kit, builder, gate, rig contract, xuất TypeScript)
src/server/studio/         xưởng img2threejs: gọi Claude (API hoặc CLI), prompt, pipeline, lưu job/version
src/game/render/           engine Three.js: lính instanced + animation lò xo, ragdoll Rapier, particle, đạn, camera
src/components/            UI game + CMS
```

**Online không gửi từng khung hình.** Server chỉ kiểm tra đội hình hai bên theo dữ liệu CMS, chọn seed, rồi hai trình duyệt tự chạy cùng một trận. Mô phỏng chỉ dùng `+ - * /`, `Math.sqrt` và PRNG có seed (không dùng `Math.sin/cos/random`), nên kết quả trùng từng bit giữa các trình duyệt. Mỗi giây hai máy gửi checksum; nếu lệch, UI báo desync. Ragdoll, particle và animation chỉ để hiển thị, không ảnh hưởng kết quả.

**Đấu online cần đăng nhập** (Socket.IO kiểm tra cookie phiên và Origin khi bắt tay, mỗi tài khoản một kết nối, giới hạn số sự kiện/giây). Kết quả chỉ được lưu vào Firestore `matches` khi cả hai máy cùng báo kết thúc ở cùng tick, một thắng một thua hoặc cả hai hòa, không desync và đủ checksum; báo thắng/thua mâu thuẫn, rời trận trước khi xác nhận hoặc lệch trận thì hủy kết quả. Chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Nội dung CMS trên Firestore:** mỗi collection CMS là một collection Firestore cùng tên (`units`, `weapons`, `assets`…, id tài liệu = id nội dung) cộng tài liệu `settings/global`. Server giữ bản sao trong RAM qua snapshot listener, nên lưu trong CMS hay sửa trực tiếp trên Firebase Console đều có hiệu lực ở trận tiếp theo, không cần khởi động lại. Tài liệu sửa tay bị sai schema sẽ bị bỏ qua và ghi log. Trường `sculpt` của asset lưu dạng chuỗi JSON (Firestore không nhận mảng lồng mảng). Lần đầu gặp Firestore trống, server tự chuyển nội dung từ SQLite cũ (`data/game.db`) nếu có, không thì ghi dữ liệu mặc định. Chưa kết nối được Firestore (thiếu credential, mất mạng) thì game chạy bằng dữ liệu mặc định, CMS từ chối lưu, server tự thử lại.

**Hiển thị:** mỗi (loại lính × bộ phận) là một `InstancedMesh`, nên số draw call không tăng theo quân số. Lính chết được giao cho ragdoll Rapier (khớp cầu tại pivot, vũ khí rơi tự do), sau vài giây đóng băng thành xác. Giới hạn ragdoll/xác chỉnh trong CMS.

## Về mô hình 3D (img2threejs)

Các factory trong `src/game/models/` tuân theo quy ước của skill img2threejs: code-only, `createXModel(params)` trả về `THREE.Group`, tham số tách khỏi đối tượng render, hệ trục +Z trước / +X là bên trái nhân vật, cặp trái/phải dựng bằng phản chiếu, noise có seed, mesh có tên, pivot `userData.part`, socket `userData.socket`, chi tiết `explodeWithParent`. Mọi mô hình tách rời được (explode) và bấm chọn được từng bộ phận ở `/models` và trong CMS.

**Giới hạn:** chưa có ảnh tham chiếu nên đây là bản dựng *reference-free, cách điệu*. Tỉ lệ người lấy từ bảng canon 4 đầu của skill (đầu, cánh tay, cẳng tay, cẳng chân); hông, đùi, vai là lựa chọn thiết kế và được ghi chú trong code. Đã kiểm tra bằng screenshot thật nhiều góc, nhưng **chưa chạy vòng so khớp ảnh có gate của img2threejs** vì vòng đó cần ảnh gốc. Khi có ảnh cho từng đối tượng, chạy pipeline img2threejs cho đối tượng đó rồi thay factory tương ứng.

## Xưởng img2threejs (`/admin/studio`)

Tạo model 3D từ **ảnh mẫu (tuỳ chọn) + mô tả**, rồi tải về hoặc thay model nhân vật trong game.

**Engine.** Có `ANTHROPIC_API_KEY` thì server gọi Claude API (`claude-opus-5`, streaming, structured output, bật server-side fallback khi bị từ chối). Không có key thì dùng Claude Code CLI (`claude -p --safe-mode`, không tool) với login sẵn trên máy chủ. Cách này chỉ chạy trên máy đã đăng nhập `claude`.

**Pipeline** (theo thứ tự của img2threejs):

1. Claude phân tích ảnh/mô tả (nhận dạng → silhouette → macro/meso/micro → vật liệu → đặc điểm nhận dạng → phần bị che) và viết **sculpt spec**: danh sách node gồm part (khớp), socket, mesh. Mesh chỉ dùng primitive: box, sphere, ellipsoid, dome, capsule, cylinder, cone, beam, torus, lathe, extrude, sweep, triangles.
2. **Generator tin cậy** (`src/game/sculpt`) dựng Three.js từ spec. Cặp trái/phải được tạo bằng phản chiếu. Không có code nào do AI viết được chạy.
3. **Gate tất định**: cấu trúc spec, rig khớp animation (tên part, cha–con, khớp không xoay), socket, chạm đất, kích thước so với model gốc, mảnh lơ lửng, ngân sách tam giác, vị trí khớp. Gate chặn thì Claude tự sửa, tối đa 2 lần.
4. Trình duyệt render 4 góc (trước, ¾, trái, sau). Claude so với ảnh mẫu, chấm điểm từng đặc điểm, rồi quyết định dừng hay sửa. Chỉ dừng khi độ giống ≥ 80%, mọi đặc điểm quan trọng ≥ 70% và không có gate chặn. Số vòng tự sửa tối đa là 3, và vòng lặp dừng sớm nếu điểm không tăng. Mỗi lần sửa tạo một version mới, admin có thể góp ý để sửa tiếp.

**Xuất file:** TypeScript (file độc lập gồm kit + code dựng, chỉ cần `three`; test đảm bảo dựng ra đúng model đã xem trong CMS), GLB/glTF (giữ `userData` part/socket/rig trong extras), OBJ và PLY (màu theo đỉnh), STL, USDZ, spec JSON.

**Dùng trong game:** chọn asset cùng rig rồi bấm *Thay model*. Spec được lưu trong asset (`sculpt`), nên game, thumbnail, preview, chế độ online và file JSON sao lưu đều dùng được ngay; animation, ragdoll và người cưỡi vẫn chạy. Bấm *Hoàn tác* để trở về model procedural. Có thể *Lưu thành asset mới* rồi bấm *Tạo lính* để mở form lính mới đã chọn sẵn model đó (hoặc từ *Quân lính* bấm *Model mới (Xưởng)*).

**Giới hạn:** đây là bản rút gọn chạy trong CMS. Pipeline không chạy bộ gate Python, `state.json` hay các phép đo Divine Eye của skill img2threejs. Model dựng hoàn toàn từ primitive (hợp style low-poly của game), và mặt bị che trong ảnh chỉ là suy đoán. Mỗi model tốn vài lượt gọi Claude; số token hiện trong từng job.
