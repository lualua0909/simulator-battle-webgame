# Mini Battle Simulator — mô phỏng đại chiến low-poly trên web

Game mô phỏng đại chiến kiểu *Totally Accurate Battle Simulator*: xếp quân trong vùng triển khai, bấm bắt đầu, xem hai đạo quân lắc lư lao vào nhau, bay người, ragdoll, mưa tên.

- **Next.js 16 (App Router) + Three.js** (engine tự viết, không dùng R3F), **Rapier** cho ragdoll.
- **4 chế độ**: đấu với máy (6 bot có hồ sơ riêng), 2 người 1 máy (xếp quân bí mật), đấu online qua mã phòng (Socket.IO), **xếp hạng** (ghép trận tự động, 6 bậc kiểu Pokemon Unite, mùa giải, bảng xếp hạng).
- **CMS** tại `/admin`: quản lý lính, kỹ năng & vũ khí, đạn, particle, asset 3D, bản đồ, bot, cài đặt + bảng khắc chế giáp. Lưu trên Firestore, có preview trực tiếp và đấu thử với hình nộm.
- **Kỹ năng hoành tráng**: sét chuỗi phóng từ tay, thiên lôi và bão sấm giáng từ trời, lốc xoáy / lốc lửa hút bổng quân địch, thiên thạch, phun lửa, dậm đất, súng hỏa mai, mưa tên, ném tảng đá, hồi máu diện rộng. Admin gán kỹ năng cho từng lính và chỉnh tốc độ đánh, tốc độ chạy, tốc độ ra kỹ năng.
- **Xưởng mô hình** tại `/models` (chỉ root/admin; user thường và khách bị chuyển về trang đăng nhập CMS): xem mọi lính/kỹ năng/asset, sửa ngay tại đó thông số, kỹ năng (gán + chỉ số), giá lính, tải model (TypeScript/GLB/OBJ/STL/PLY/USDZ) và yêu cầu Claude generate lại model bằng img2threejs.
- **Mô hình 3D procedural** theo chuẩn img2threejs, dựng hoàn toàn bằng code: người (nhiều kiểu giáp/mũ/vũ khí), ngựa, voi/ma mút, rồng, đại bàng, máy bắn đá, cây (thông/sồi/bạch dương/khô/cọ/xương rồng), đá, bụi, sông, địa hình, 6 kiểu rương hộp quà.
- **Coin, thẻ bài, hộp quà** (Phase 2): ví coin trên Firestore (1.000 VNĐ = 1.000 coin), hộp quà hằng ngày + hộp x giờ (rương 3D nhún nhảy, mở có ánh sáng), bộ sưu tập thẻ kiểu Clash Royale, mở khóa lính, mua thẻ, nâng lính 1–5 sao. Kế hoạch nạp tiền thật: [docs/MONETIZATION.md](docs/MONETIZATION.md).

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
| `npm test` | test mô phỏng (tất định, bot hợp lệ, seed CMS hợp lệ, sao nâng cấp) + luật coin/hộp quà/nâng sao/thưởng thắng bot + luật xếp hạng (♦, mùa, ghép trận, chống nhường trận) + phòng online và phòng xếp hạng (lính chưa mở khóa, sao, ghép cặp, đầu hàng) + sculpt spec (gate, phản chiếu, file TS xuất ra khớp model) |
| `npm run typecheck` | kiểm tra TypeScript |
| `npm run db:reset` | ghi đè nội dung CMS trên Firestore bằng dữ liệu mặc định |
| `npm run shots -- models` | chụp ảnh mọi mô hình vào `.shots/models` (cần server đang chạy) |

Biến môi trường: xem `.env.example` (`FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_ROOT_EMAILS`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY`, `DATABASE_PATH`, `PORT`, `ANTHROPIC_API_KEY`).

Tài khoản: Firebase Auth (email/mật khẩu + Google). Hồ sơ lưu ở Firestore `users/{uid}` (`role`: 0 root, 1 admin, 2 user; `fcmTokens`), ví coin ở `players/{uid}` + sổ giao dịch `players/{uid}/ledger` (chỉ server đọc/ghi). Chỉ root/admin vào `/admin`; quản lý user ở `/admin/users`. Root đầu tiên: thêm email vào `FIREBASE_ROOT_EMAILS` rồi đăng nhập bằng Google. Firebase Console cần bật provider Email/Password + Google, và triển khai `firestore.rules` (client chỉ đọc hồ sơ của mình, mọi ghi đi qua server).

> **Triển khai:** chế độ online cần Node server chạy lâu dài (VPS, Railway, Render, Fly.io…) vì dùng WebSocket và SQLite file. Không chạy được trên serverless (Vercel).

## Coin, thẻ bài & hộp quà

Mọi con số nằm trên server: trình duyệt chỉ gửi ý định (mở hộp, mở khóa, nâng sao, mua thẻ), server tính trong **Firestore transaction** rồi trả ví mới. Chi tiết dữ liệu, luật và bảo mật: [ARCHITECTURE.md mục 6](docs/ARCHITECTURE.md#6-tiền-tệ-thẻ-bài-hộp-quà).

- **Thanh coin** góc trên phải màn chính và màn chơi, kèm tên và avatar (ảnh Google, không có thì avatar DiceBear kiểu `clay` sinh theo uid). Bấm avatar để vào CMS (admin) hoặc đăng xuất.
- **Menu góc dưới trái** màn chính: *Hộp quà hằng ngày* (mỗi ngày theo giờ Việt Nam), *Hộp x giờ* (hiện sau khi mở hộp hằng ngày, mở được mỗi `x` giờ kể từ hộp gần nhất, mặc định 3), *Bộ sưu tập thẻ*. Hộp cho coin ngẫu nhiên và thẻ của vài loại lính ngẫu nhiên (lính rẻ dễ ra hơn).
- **Mở hộp:** rương 3D (6 kiểu: gỗ, bạc, vàng, khổng lồ, phép thuật, siêu phép thuật — dựng lại từ ảnh mẫu theo chuẩn img2threejs, `src/game/models/chest.ts`) nhún nhảy lắc lư khi chờ, rung khi chờ server, bật nắp với quầng sáng, cột sáng, tia sáng và hạt lấp lánh, rồi coin và thẻ bài bay ra.
- **Bộ sưu tập thẻ:** mỗi lính là một thẻ kiểu Clash Royale (thẻ đang có / cần cho sao tiếp theo, sao, ổ khóa + giá). Lên 1★ cần 100 thẻ, 2★ 200 thẻ … 5★ 500 thẻ (dùng hết thẻ và coin mỗi lần nâng; chỉnh riêng từng lính). Mỗi sao +10% máu và sát thương (chỉnh trong Cài đặt).
- **Mở khóa lính:** lính giá ≤ 150 miễn phí cho mọi người (kể cả khách), lính khác mở bằng coin. Lính chưa mở khóa hiện mờ có ổ khóa trong bảng xếp quân, không đặt được; server từ chối đội hình online có lính chưa mở khóa.
- **Sao trong trận:** đấu với máy luôn tính sao của bạn; 2 người 1 máy không tính; đấu online **chủ phòng chọn** có tính sao hay không; xếp hạng luôn tính sao (server đọc sao từ ví của từng người).
- **Thưởng thắng bot:** lúc bắt đầu trận, game báo server (`bot-start`) để server ghi *vé trận* (bot nào, mấy bot, lúc nào). Nhận thưởng phải có vé, mỗi vé dùng một lần, trận phải dài ít nhất 15 giây, cách lần trước 20 giây, tối đa 30 lần mỗi ngày (chỉnh trong Cài đặt). Server không tự xem trận nên không chứng minh được thắng thật; các giới hạn này chỉ chặn script cày thưởng không giới hạn.
- **Admin:** `/models` tab *🃏 Thẻ & sao* đặt giá mở khóa, giá thẻ, thẻ + coin mỗi sao; *Cài đặt* đặt `x` giờ, % mỗi sao, phần thưởng và kiểu rương từng hộp; `/admin/users/{uid}` xem ví, sổ giao dịch và cộng/trừ coin (bắt buộc ghi lý do — cách nạp tay tạm thời khi chưa có cổng thanh toán).
- **Firestore đã có dữ liệu:** lính cũ được đọc là miễn phí và không bán thẻ cho tới khi đặt giá. Trang Tổng quan CMS → *Nội dung mặc định mới* → tick *Đặt giá mở khóa, giá thẻ và giá nâng sao mặc định*.

## Xếp hạng

Vào `/play?mode=ranked` (thẻ *Xếp hạng* ở màn chính). Bấm *Tìm trận*, server ghép với người có hạng gần nhất rồi đưa cả hai vào một phòng riêng: bản đồ ngẫu nhiên, ngân sách của bản đồ, tính sao, 30 giây xếp quân, một trận duy nhất.

- **6 bậc:** Tân Binh → Tinh Nhuệ → Cao Thủ → Kỳ Cựu → Siêu Việt → Bậc Thầy. Năm bậc đầu chia hạng, mỗi hạng vài ♦; Bậc Thầy tính điểm 0–99999. Thắng +1 ♦, thua −1 ♦ (Tân Binh không mất ♦), đủ ♦ thắng thêm một trận thì lên hạng, hết ♦ thua tiếp thì xuống hạng, kể cả rớt bậc.
- **Mùa giải** tự nối tiếp (mặc định 30 ngày từ `ranked.seasonStart`). Hết mùa: nhận rương theo bậc cuối mùa, mùa mới bắt đầu thấp hơn 1 bậc. Có bảng xếp hạng theo mùa.
- **Thắng có rương** (tối đa 20 rương/ngày).
- **Chống acc phụ cày thắng:** chỉ ghép tự động (không vào bằng mã), tài khoản ≥ 3 ngày tuổi và đã nhận thưởng thắng bot 10 lần mới được xếp hạng, không ghép hai người cùng IP, cùng hai tài khoản chỉ tính 2 trận/ngày, đối thủ bỏ trận quá sớm hoặc đội quá rẻ thì bên thắng không được ♦, kết quả hai máy báo lệch nhau thì hủy và đếm tranh chấp (quá 5 lần/mùa thì khóa xếp hạng). Trận đáng ngờ hiện ở CMS `/admin/ranked`.

Mọi con số chỉnh ở CMS *Cài đặt* (mục Xếp hạng). Chi tiết: [ARCHITECTURE.md mục 7](docs/ARCHITECTURE.md#7-chế-độ-xếp-hạng-và-chống-cày-thắng).

**Font game:** mọi màn game (trừ `/admin` và `/models`) dùng font Clash từ `data/Clash_Regular.otf.ttf`, chữ màu `#2D3232`, cỡ tối thiểu 16px. File được phục vụ qua `/api/fonts/clash`: chép bản mới đè lên là có hiệu lực, không cần build lại; thiếu file thì game dùng font dự phòng. File Clash hiện tại **thiếu phần lớn chữ tiếng Việt có dấu chồng** (ơ ư ạ ả ấ ầ ậ ế ệ ộ ợ ự…), các chữ này tạm lấy từ Paytone One nên nhìn hơi lệch kiểu; thay bằng bản Clash có tiếng Việt là hết. Lưu ý file ghi bản quyền Supercell ("All rights reserved"): cần giấy phép trước khi dùng trong sản phẩm thu tiền.

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
src/game/render/           engine Three.js: lính instanced + animation lò xo, ragdoll Rapier, particle, đạn, hiệu ứng kỹ năng, camera
src/game/arena.ts          đấu trường thử kỹ năng (1 lính vs hình nộm) cho preview CMS và /models
src/shared/economy.ts      luật coin, thẻ, sao, mở khóa, hộp quà, thưởng thắng bot (thuần, có test)
src/server/players.ts      ví coin trên Firestore: transaction + sổ giao dịch
src/shared/ranked.ts       luật xếp hạng: bậc/hạng/♦, mùa, ghép trận, chống nhường trận (thuần, có test)
src/server/ranked.ts       xếp hạng trên Firestore: chốt kết quả, bảng xếp hạng, cờ gian lận
src/components/game/ranked.tsx  sảnh xếp hạng, huy hiệu 6 bậc, bảng xếp hạng, kết quả ♦
src/components/player/     HUD coin, menu hộp quà, màn mở hộp (rương 3D), bộ sưu tập thẻ
src/components/            UI game + CMS
```

**Online không gửi từng khung hình.** Server chỉ kiểm tra đội hình hai bên theo dữ liệu CMS, chọn seed, rồi hai trình duyệt tự chạy cùng một trận. Mô phỏng chỉ dùng `+ - * /`, `Math.sqrt` và PRNG có seed (không dùng `Math.sin/cos/random`), nên kết quả trùng từng bit giữa các trình duyệt. Mỗi giây hai máy gửi checksum; nếu lệch, UI báo desync. Ragdoll, particle và animation chỉ để hiển thị, không ảnh hưởng kết quả.

**Đấu online cần đăng nhập** (Socket.IO kiểm tra cookie phiên và Origin khi bắt tay, mỗi tài khoản một kết nối, giới hạn số sự kiện/giây). Kết quả chỉ được lưu vào Firestore `matches` khi cả hai máy cùng báo kết thúc ở cùng tick, một thắng một thua hoặc cả hai hòa, không desync và đủ checksum; báo thắng/thua mâu thuẫn hoặc lệch trận thì hủy kết quả. Đầu hàng hoặc mất kết nối trước khi báo kết thúc thì bị loại: trận 2 người, bên còn lại thắng ngay. Chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Nội dung CMS trên Firestore:** mỗi collection CMS là một collection Firestore cùng tên (`units`, `weapons`, `assets`…, id tài liệu = id nội dung) cộng tài liệu `settings/global`. Server giữ bản sao trong RAM qua snapshot listener, nên lưu trong CMS hay sửa trực tiếp trên Firebase Console đều có hiệu lực ở trận tiếp theo, không cần khởi động lại. Tài liệu sửa tay bị sai schema sẽ bị bỏ qua và ghi log. Trường `sculpt` của asset lưu dạng chuỗi JSON (Firestore không nhận mảng lồng mảng). Lần đầu gặp Firestore trống, server tự chuyển nội dung từ SQLite cũ (`data/game.db`) nếu có, không thì ghi dữ liệu mặc định. Chưa kết nối được Firestore (thiếu credential, mất mạng) thì game chạy bằng dữ liệu mặc định, CMS từ chối lưu, server tự thử lại.

**Hiển thị:** mỗi (loại lính × bộ phận) là một `InstancedMesh`, nên số draw call không tăng theo quân số. Lính chết được giao cho ragdoll Rapier (khớp cầu tại pivot, vũ khí rơi tự do), sau vài giây đóng băng thành xác. Giới hạn ragdoll/xác chỉnh trong CMS. Lính ngoài khung hình (kể cả bóng) không được vẽ, lính ở xa chỉ cập nhật dáng mỗi 2–3 khung. Engine có 3 mức chất lượng (`src/game/render/quality.ts`): điện thoại bắt đầu ở mức trung bình, máy nào dưới 40 fps liên tục thì tự hạ một mức (độ phân giải, bóng đổ, đèn chớp, giới hạn ragdoll/xác). Vì vậy giới hạn trong CMS là mức trần: mức trung bình tối đa 30 ragdoll / 300 xác, mức thấp 12 / 150.

## Kỹ năng & hiệu ứng

Danh mục CMS **Kỹ năng & vũ khí** (collection `weapons`) chứa mọi đòn. Mỗi lính có **1 đòn cơ bản** (`weaponId`, quyết định cách di chuyển và chọn mục tiêu) và tối đa **6 kỹ năng** (`skillIds`). Trong trận, lính tự tung kỹ năng theo thứ tự đã chọn khi hồi chiêu xong, mục tiêu trong tầm và có đủ `minTargets` địch trong vùng (kỹ năng vùng tự nhắm vào cụm địch đông nhất). Lúc niệm hoặc kênh, lính đứng yên và quay về mục tiêu. Người chơi không điều khiển kỹ năng.

| Kiểu | Làm gì |
| --- | --- |
| `melee`, `projectile`, `breath`, `heal` | như trước; `heal` có bán kính thì hồi cả vùng |
| `chain` | sét trúng mục tiêu rồi nhảy sang `chainCount` địch gần nhất, sát thương giảm theo `chainFalloff` |
| `strike` | vòng cảnh báo trên đất, sau `strikeDelay` giây giáng sét hoặc thiên thạch (`strikeVfx`); `strikeCount` lần rải trong `strikeSpread` m, trúng cả lính bay |
| `vortex` | lốc xoáy sinh trước mục tiêu, đuổi địch gần nhất trong `duration` giây, hút xoáy (`pull`), nhấc bổng (`lift`, lính nặng/kháng đẩy khó bị nhấc), tan thì quăng văng |
| `nova` | chấn động quanh người ra đòn, chỉ trúng địch |

Mọi kiểu đều có thể **kênh** (`duration` > 0: lặp hiệu ứng mỗi `interval` giây, ví dụ phun lửa liên tục, bắn liên thanh), gây **choáng** (`stunDuration`) và **cháy** (`burnDps` × `burnDuration`, sát thương lửa theo bảng khắc chế). Lính có `attackSpeed` (chia hồi chiêu + thời gian vung của đòn cơ bản) và `castSpeed` (chia hồi chiêu, thời gian niệm và nhịp kênh của kỹ năng). Kỹ năng vẫn chạy trong mô phỏng tất định nên đấu online không lệch.

**Hình ảnh** (`src/game/render/effects.ts`, chỉ để hiển thị): tia sét zigzag phân nhánh nhấp nháy theo tay/mục tiêu, vòng cảnh báo, sóng xung kích, vết cháy trên đất, thiên thạch rơi kèm vệt lửa, lốc xoáy xoay nhiều tầng kèm bụi và mảnh vỡ, tia điện quanh tay khi niệm, lửa trên lính đang cháy, đèn chớp sáng và rung camera (tắt được trong Cài đặt). Màu sét/lốc/sóng chỉnh bằng `vfxColor`; particle phụ (`areaParticleId`) dùng cho vùng nổ, chân lốc và khói nòng súng. Model mới theo chuẩn img2threejs: súng hỏa mai (socket `muzzle`), đầu trượng (socket `staff.tip`), đạn vạch sáng, thiên thạch, phễu lốc xoáy (`src/game/models/effects.ts`). Hiệu ứng phát ra từ socket `mouth` → `muzzle` → `staff.tip` → `hand.R`.

**Đấu thử:** editor kỹ năng và `/models` có khung *Đấu thử* chạy engine trận thật với bản nháp chưa lưu (1 lính vs hình nộm; kỹ năng hồi máu thì có đồng đội bị đánh). Root/admin xem tại `/models?skill=<id>` hoặc `/models?unit=<id>&arena=1`.

**Dữ liệu Firestore có sẵn:** nội dung mặc định mới (kỹ năng, lính, particle…) không tự ghi vào Firestore đã có dữ liệu. Trang Tổng quan của CMS hiện khung *Nội dung mặc định mới*: chọn mục muốn thêm, có tùy chọn gán kỹ năng mặc định cho lính mặc định chưa có kỹ năng. Mục đang có không bị sửa hay xóa.

## Về mô hình 3D (img2threejs)

Các factory trong `src/game/models/` tuân theo quy ước của skill img2threejs: code-only, `createXModel(params)` trả về `THREE.Group`, tham số tách khỏi đối tượng render, hệ trục +Z trước / +X là bên trái nhân vật, cặp trái/phải dựng bằng phản chiếu, noise có seed, mesh có tên, pivot `userData.part`, socket `userData.socket`, chi tiết `explodeWithParent`. Mọi mô hình tách rời được (explode) và bấm chọn được từng bộ phận ở `/models` và trong CMS.

**Giới hạn:** chưa có ảnh tham chiếu nên đây là bản dựng *reference-free, cách điệu*. Tỉ lệ người lấy từ bảng canon 4 đầu của skill (đầu, cánh tay, cẳng tay, cẳng chân); hông, đùi, vai là lựa chọn thiết kế và được ghi chú trong code. Đã kiểm tra bằng screenshot thật nhiều góc, nhưng **chưa chạy vòng so khớp ảnh có gate của img2threejs** vì vòng đó cần ảnh gốc. Khi có ảnh cho từng đối tượng, chạy pipeline img2threejs cho đối tượng đó rồi thay factory tương ứng.

## Xưởng mô hình (`/models`, chỉ root/admin)

Mọi chức năng liên quan tới nhân vật gộp ở đây (editor lính và `/admin/studio` cũ chuyển hướng về trang này). User thường và khách mở trang này bị chuyển về trang đăng nhập CMS. Root/admin có panel bên phải với 5 tab, mọi chỉnh sửa là bản nháp xem trước trực tiếp trong khung 3D / *Đấu thử*, bấm *Lưu* (Ctrl/⌘+S) để ghi:

- **Thông số:** tên, phe, vai trò, tốc độ, máu, giáp, va chạm, bay…
- **Kỹ năng:** đòn cơ bản, tối đa 6 kỹ năng (thêm/bỏ/đổi thứ tự) và sửa chỉ số từng kỹ năng. Kỹ năng dùng chung giữa các lính, panel báo lính nào bị ảnh hưởng.
- **Giá:** giá, DPS, máu hiệu dụng, hiệu quả/giá xếp hạng với mọi lính, gợi ý giá cân bằng.
- **Thẻ & sao:** giá mở khóa (0 = miễn phí), giá 1 thẻ (0 = không bán), số thẻ và coin cho từng bậc 1★–5★, kèm thẻ xem trước.
- **Mô hình:** chọn model/người cưỡi, tải về, hoàn tác model img2threejs, và *Yêu cầu Claude generate lại* (pipeline bên dưới). Chọn version để xem thử trong khung 3D trước khi *Thay model của asset* hoặc *Tạo asset riêng cho lính này*.

Chọn asset ở danh sách bên trái để dùng tab Mô hình cho cây/đá/bụi; chọn kỹ năng để sửa chỉ số và xem đấu thử; chọn một kiểu rương ở mục *Hộp quà* để xem và bấm *Mở thử* (`/models?chest=golden&open=1&bare=1` cho ảnh chụp).

### Claude generate lại model (img2threejs)

Claude dựng model mới dựa trên asset gốc, **góp ý/mô tả (tuỳ chọn) + ảnh mẫu (tuỳ chọn)**.

**Engine.** Có `ANTHROPIC_API_KEY` thì server gọi Claude API (`claude-sonnet-5`, effort medium, streaming, structured output). Không có key thì dùng Claude Code CLI (`claude -p --safe-mode`, không tool) với login sẵn trên máy chủ. Cách này chỉ chạy trên máy đã đăng nhập `claude`.

**Pipeline** (theo thứ tự của img2threejs):

1. Claude phân tích ảnh/mô tả (nhận dạng → silhouette → macro/meso/micro → vật liệu → đặc điểm nhận dạng → phần bị che) và viết **sculpt spec**: danh sách node gồm part (khớp), socket, mesh. Mesh chỉ dùng primitive: box, sphere, ellipsoid, dome, capsule, cylinder, cone, beam, torus, lathe, extrude, sweep, triangles.
2. **Generator tin cậy** (`src/game/sculpt`) dựng Three.js từ spec. Cặp trái/phải được tạo bằng phản chiếu. Không có code nào do AI viết được chạy.
3. **Gate tất định**: cấu trúc spec, rig khớp animation (tên part, cha–con, khớp không xoay), socket, chạm đất, kích thước so với model gốc, mảnh lơ lửng, ngân sách tam giác, vị trí khớp. Gate chặn thì Claude tự sửa, tối đa 2 lần.
4. Trình duyệt render 4 góc (trước, ¾, trái, sau). Claude so với ảnh mẫu, chấm điểm từng đặc điểm, rồi quyết định dừng hay sửa. Chỉ dừng khi độ giống ≥ 80%, mọi đặc điểm quan trọng ≥ 70% và không có gate chặn. Số vòng tự sửa tối đa là 3, và vòng lặp dừng sớm nếu điểm không tăng. Mỗi lần sửa tạo một version mới, admin có thể góp ý để sửa tiếp.

**Xuất file:** TypeScript (model img2threejs: file độc lập gồm kit + code dựng, chỉ cần `three`, test đảm bảo dựng ra đúng model đã xem; preset procedural: module độc lập chứa cây node/part/socket và lưới đã bake), GLB/glTF (giữ `userData` part/socket/rig trong extras), OBJ và PLY (màu theo đỉnh), STL, USDZ, spec JSON.

**Dùng trong game:** bấm *Thay model của asset*. Spec được lưu trong asset (`sculpt`), nên game, thumbnail, preview, chế độ online và file JSON sao lưu đều dùng được ngay; animation, ragdoll và người cưỡi vẫn chạy. Bấm *Hoàn tác về procedural* để trở về model cũ. *Tạo asset riêng cho lính này* không đụng asset dùng chung (nhớ *Lưu* lính).

**Giới hạn:** đây là bản rút gọn chạy trong web. Không còn tạo đạo cụ tự do (prop) từ số 0: model luôn dựa trên một asset. Pipeline không chạy bộ gate Python, `state.json` hay các phép đo Divine Eye của skill img2threejs. Model dựng hoàn toàn từ primitive (hợp style low-poly của game), và mặt bị che trong ảnh chỉ là suy đoán. Mỗi model tốn vài lượt gọi Claude; số token hiện trong từng job.
