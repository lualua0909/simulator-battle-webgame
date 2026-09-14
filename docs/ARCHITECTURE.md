# Đại Chiến Lô Nhô — Tài liệu kiến trúc, PvP online, phân quyền và bảo mật

Tài liệu mô tả hệ thống theo code hiện tại (Next.js 16 + Socket.IO trong một tiến trình Node, Firebase Auth/Firestore/FCM, SQLite, Claude API/CLI). Sơ đồ viết bằng Mermaid, xem được trực tiếp trên GitHub/VS Code.

Mục lục:

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Sơ đồ tất cả tính năng](#2-sơ-đồ-tất-cả-tính-năng)
3. [Giao tiếp cho tính năng người vs người (online)](#3-giao-tiếp-cho-tính-năng-người-vs-người-online)
4. [Cơ chế phân quyền](#4-cơ-chế-phân-quyền)
5. [Bảo mật](#5-bảo-mật)
6. [Tiền tệ, thẻ bài, hộp quà](#6-tiền-tệ-thẻ-bài-hộp-quà)
7. [Phụ lục: bảng API](#7-phụ-lục-bảng-api)

Kế hoạch kiếm tiền, nạp tiền và pháp lý: [MONETIZATION.md](MONETIZATION.md).

---

## 1. Tổng quan hệ thống

```mermaid
flowchart LR
  subgraph Browser["Trình duyệt"]
    Home["/ Màn chính<br/>ví coin, hộp quà, bộ sưu tập thẻ"]
    Game["/play<br/>Game client<br/>(Three.js + sim tất định)"]
    Models["/models<br/>Xưởng mô hình (sửa lính, Claude)"]
    CMS["/admin<br/>CMS + Xưởng"]
    FBClient["Firebase Auth SDK<br/>(client)"]
  end

  subgraph Node["Node process: server.ts (một cổng, PORT)"]
    Next["Next.js<br/>pages + route handlers /api/*"]
    IO["Socket.IO /socket.io<br/>rooms.ts"]
    Content["content.ts<br/>bản sao CMS trong RAM"]
    Players["players.ts<br/>ví coin (transaction)"]
    Studio["studio/pipeline.ts"]
    SQLite[("SQLite data/game.db<br/>job Xưởng")]
  end

  subgraph Google["Firebase / Google Cloud"]
    FAuth["Firebase Auth"]
    FS[("Firestore<br/>users, players (+ledger), matches,<br/>units, weapons, ..., settings/global")]
    FCM["Firebase Cloud Messaging"]
  end

  Claude["Claude API<br/>hoặc Claude Code CLI"]

  Game -- "HTTP GET /api/config" --> Next
  Home -- "HTTP /api/player (cookie phiên)" --> Next
  Game <-- "WebSocket (PvP, cookie phiên)" --> IO
  CMS -- "HTTP /api/admin/* (cookie phiên)" --> Next
  FBClient -- "đăng nhập" --> FAuth
  FBClient -- "idToken → POST /api/auth/session" --> Next

  Next --> Content
  IO --> Content
  Next --> Players
  IO -- "đọc sao, lính đã mở khóa" --> Players
  Players -- "transaction + ledger (Admin SDK)" --> FS
  IO -- "verifySessionCookie" --> FAuth
  IO -- "lưu kết quả trận" --> FS
  Content <-- "onSnapshot + ghi (Admin SDK)" --> FS
  Next -- "verifySessionCookie, quản lý user" --> FAuth
  Next -- "users/{uid}" --> FS
  Next -- "gửi thông báo" --> FCM
  Next --> Studio
  Studio --> SQLite
  Studio -- "HTTPS / spawn claude -p" --> Claude
```

Điểm chính:

- **Một tiến trình Node** chạy cả Next.js và Socket.IO trên cùng cổng. Không có microservice, không có server-to-server giữa các node game. Muốn chạy nhiều instance cần thêm adapter (Redis) cho Socket.IO và sticky session — hiện **chưa có**.
- **Giao tiếp server-to-server** thực tế chỉ có: Node ↔ Firebase (Auth, Firestore, FCM qua Admin SDK) và Node ↔ Anthropic (Claude API) hoặc tiến trình con `claude` CLI.
- **Nội dung CMS** là nguồn chuẩn cho cả game, bot và kiểm tra đội hình online. Server giữ bản sao RAM qua snapshot listener; sửa trên CMS hay Firebase Console đều áp dụng từ trận sau.
- **Ví coin** (coin, thẻ, sao, lính đã mở khóa, giờ mở hộp) nằm ở Firestore `players/{uid}`, chỉ server đọc/ghi, mỗi thay đổi là một transaction kèm dòng sổ giao dịch (mục 6).

---

## 2. Sơ đồ tất cả tính năng

```mermaid
mindmap
  root((Đại Chiến Lô Nhô))
    Chơi game /play
      Đấu với máy
        6 bot có hồ sơ
        Bot chọn quân theo khắc chế
        Bot phản ứng theo đội hình người chơi
      2 người 1 máy
        Xếp quân lần lượt
        Chế độ xếp bí mật
      Đấu online
        Bắt buộc đăng nhập
        Tạo phòng mã 5 ký tự
        Vào phòng bằng mã
        Chủ phòng chọn bản đồ, ngân sách, có tính sao hay không
        Server kiểm tra lính đã mở khóa
        Sẵn sàng / hủy sẵn sàng
        Server kiểm tra đội hình
        Hai máy chạy cùng seed
        Checksum phát hiện desync
        Hai bên xác nhận kết quả
        Lưu kết quả vào matches
        Tự vào lại phòng khi rớt mạng
      Xếp quân
        Đặt / rải hàng loạt / xóa
        Hoàn tác Ctrl Z
        Ngân sách và giới hạn lính
      Trận đấu
        Mô phỏng tất định 30 Hz
        Tạm dừng, tốc độ 0.25x đến 4x
        Ragdoll Rapier, particle, đạn
        Cinematic mở màn và kết thúc
    Màn chính /
      Thanh coin, tên, avatar DiceBear
      Hộp quà hằng ngày
      Hộp x giờ sau hộp hằng ngày
      Rương 3D nhún nhảy, mở có ánh sáng
      Bộ sưu tập thẻ kiểu Clash Royale
      Mở khóa lính, mua thẻ, nâng sao bằng coin
    Xem mô hình /models
      Tách rời bộ phận
      Chọn từng part
      Xem thử 6 kiểu rương
      Admin chỉnh giá mở khóa, giá thẻ, thẻ và coin mỗi sao
    Tài khoản
      Email mật khẩu
      Google
      Phiên cookie 14 ngày
      Đăng ký FCM token
    CMS /admin root và admin
      Nội dung game
        factions
        units
        weapons
        projectiles
        particles
        assets 3D
        maps
        bots
        settings và bảng khắc chế giáp
      Kiểm tra schema và tham chiếu
      Preview trực tiếp
      Sao lưu / nhập / reset bundle JSON
      Quản lý người dùng
        Tạo, sửa, khóa, xóa
        Đổi vai trò
        Gửi thông báo đẩy
        Xem ví, sổ giao dịch, cộng trừ coin
      Cài đặt hộp quà và sao
      Xưởng img2threejs
        Ảnh mẫu và mô tả
        Claude viết sculpt spec
        Gate tất định
        Review 4 góc, tự sửa
        Xuất TS GLB OBJ STL PLY USDZ
        Thay model trong game / hoàn tác
```

Bảng tính năng theo module code:

| Nhóm | Tính năng | Code chính |
| --- | --- | --- |
| Game | 3 chế độ `ai` / `local` / `online` | [GameClient.tsx](../src/components/game/GameClient.tsx) |
| Game | Mô phỏng tất định, checksum | [world.ts](../src/game/sim/world.ts), [engine.ts](../src/game/render/engine.ts) |
| Game | Kiểm tra đội hình (dùng chung client + server) | [army.ts](../src/game/sim/army.ts) |
| Game | Bot | [generate.ts](../src/game/bot/generate.ts) |
| Online | Xác thực socket, phòng, sẵn sàng, bắt đầu trận, desync | [rooms.ts](../src/server/rooms.ts), [net.ts](../src/shared/net.ts), [client.ts](../src/game/net/client.ts) |
| Online | Xác nhận và lưu kết quả trận | [matches.ts](../src/server/matches.ts) |
| Nội dung | Firestore + bản sao RAM + seed | [content.ts](../src/server/content.ts), [schema.ts](../src/shared/schema.ts) |
| Tài khoản | Phiên, hồ sơ, vai trò | [users.ts](../src/server/users.ts), [shared/users.ts](../src/shared/users.ts), [session route](../src/app/api/auth/session/route.ts) |
| CMS | CRUD collection, settings, bundle | [src/app/api/admin/](../src/app/api/admin/) |
| CMS | Quản lý user, FCM | [users routes](../src/app/api/admin/users/), [userAdmin.ts](../src/server/userAdmin.ts) |
| Xưởng | Pipeline Claude, gate, xuất file | [studio/](../src/server/studio/), [sculpt/](../src/game/sculpt/) |
| Kinh tế | Luật thuần: hộp quà, nâng sao, mở khóa, mua thẻ, cộng/trừ coin | [economy.ts](../src/shared/economy.ts) |
| Kinh tế | Ví Firestore trong transaction + sổ giao dịch, API người chơi / admin | [players.ts](../src/server/players.ts), [api/player](../src/app/api/player/route.ts), [wallet route](../src/app/api/admin/users/[uid]/wallet/route.ts) |
| Kinh tế | HUD coin, menu hộp quà, màn mở hộp, bộ sưu tập thẻ | [src/components/player/](../src/components/player/) |
| Kinh tế | Rương 3D procedural (6 kiểu) | [chest.ts](../src/game/models/chest.ts), [ChestStage.tsx](../src/components/player/ChestStage.tsx) |

---

## 3. Giao tiếp cho tính năng người vs người (online)

### 3.1 Mô hình: server làm trọng tài, không mô phỏng

Hai người chơi **không nói chuyện trực tiếp với nhau** (không P2P/WebRTC) và **không có server-to-server**. Luồng là **Client A ↔ Node server ↔ Client B** qua Socket.IO (chỉ transport `websocket`).

Server **không chạy trận**. Server làm 5 việc:

1. **Xác thực kết nối:** chỉ user đã đăng nhập, không bị khóa, mở từ đúng trang của site mới kết nối được (xem 3.7).
2. **Quản lý phòng:** tạo, vào, chỗ ngồi `blue`/`red`. Chỗ ngồi gắn với `uid`.
3. **Kiểm tra đội hình** theo dữ liệu CMS: schema, lính tồn tại, trong vùng triển khai, số lính, ngân sách.
4. **Bắt đầu trận** khi cả hai sẵn sàng: sinh `seed` bằng `crypto.randomInt`, gửi `battle:start` gồm seed, hai đội hình và `configVersion`, đồng thời giữ bản ghi trận (`BattleRecord`) trên server.
5. **Trọng tài kết quả:** so checksum mỗi 30 tick (1 giây mô phỏng). Kết quả chỉ được lưu vào Firestore `matches` khi **hai bên báo khớp nhau** (xem 3.6).

Hai trình duyệt tự chạy cùng một trận. Mô phỏng chỉ dùng `+ - * /`, `Math.sqrt` và PRNG có seed, nên kết quả trùng từng bit.

```mermaid
flowchart LR
  A["Client A (blue)<br/>đã đăng nhập<br/>sim tất định"] <-- "Socket.IO websocket<br/>cookie sb_session" --> S["Node server<br/>rooms.ts (RAM)"]
  B["Client B (red)<br/>đã đăng nhập<br/>sim tất định"] <-- "Socket.IO websocket<br/>cookie sb_session" --> S
  S -- "đọc units, maps, settings" --> C["content.ts<br/>(bản sao Firestore)"]
  S -- "verifySessionCookie" --> FA["Firebase Auth"]
  S -- "lưu kết quả hợp lệ" --> M[("Firestore matches")]
  A -. "GET /api/config" .-> N["Next.js /api/config"]
  B -. "GET /api/config" .-> N
```

### 3.2 Giao thức sự kiện

Định nghĩa ở [src/shared/net.ts](../src/shared/net.ts). Client không gửi tên hay token: server lấy danh tính và tên hiển thị từ cookie phiên.

Client → Server:

| Sự kiện | Payload | Ack | Điều kiện server chấp nhận |
| --- | --- | --- | --- |
| `room:create` | — | `{ ok, code, side }` | CMS có ít nhất 1 map |
| `room:join` | `{ code }` | `{ ok, code, side }` | phòng tồn tại; `uid` đã có chỗ trong phòng thì lấy lại chỗ đó, không thì vào `red` nếu còn trống |
| `room:settings` | `{ mapId, budget, useStars }` | — | chỉ `blue` (chủ phòng), phase `lobby`, map tồn tại, budget 100–1.000.000, `useStars` boolean |
| `room:ready` | `{ army: Placement[] }` | `{ ok }` / `{ ok:false, error }` | phiên vẫn hợp lệ (kiểm tra lại với Firebase), phase `lobby`, `armySchema` (≤ 500), `validateArmy` pass, không rỗng, **mọi lính đã mở khóa** theo ví Firestore của người đó (server lưu luôn sao của các lính trong đội hình) |
| `room:unready` | — | — | phase `lobby` |
| `battle:checksum` | `{ tick, hash }` | — | đang có trận, bên này chưa báo kết thúc, `tick` là bội số dương của 30 và ≤ tick tối đa, mỗi tick chỉ nhận lần đầu |
| `battle:end` | `{ outcome: 'win' \| 'lose' \| 'draw', tick }` | — | đang có trận, bên này chưa báo; payload sai thì hủy kết quả |
| `room:leave` / `disconnect` | — | — | luôn |

Server → Client:

| Sự kiện | Payload | Khi nào |
| --- | --- | --- |
| `room:state` | `{ code, phase, mapId, budget, useStars, players: { name, ready, connected, units, cost } }` | mọi thay đổi phòng (gửi cả phòng) |
| `battle:start` | `{ seed, mapId, budget, armies: { blue, red }, useStars, stars: { blue, red }, configVersion }` | cả hai `ready` và cùng đang kết nối; `stars` lấy từ ví lúc sẵn sàng, rỗng khi chủ phòng tắt sao |
| `battle:desync` | `{ tick }` | hash hai bên khác nhau tại cùng tick (lần đầu) |
| `battle:result` | `{ ok: true, winner }` / `{ ok: false, error }` | kết quả đã lưu, hoặc bị hủy kèm lý do |

Lưu ý: `room:state` **chỉ lộ tên, số lính và tổng chi phí**, không lộ vị trí/loại lính. Đội hình đối thủ chỉ gửi xuống lúc `battle:start`.

### 3.3 Trình tự một trận

```mermaid
sequenceDiagram
  autonumber
  participant A as Client A (blue)
  participant S as Node server (rooms.ts)
  participant F as Firebase (Auth + Firestore)
  participant B as Client B (red)

  Note over A,B: Cả hai đã đăng nhập, có cookie sb_session
  A->>S: WebSocket handshake (Origin + cookie)
  S->>S: allowRequest: Origin khớp Host
  S->>F: verifySessionCookie + đọc users/{uid}
  S-->>A: connect (sai thì connect_error "unauthorized")
  B->>S: WebSocket handshake (Origin + cookie)
  S->>F: verifySessionCookie + đọc users/{uid}
  S-->>B: connect

  A->>S: room:create
  S-->>A: ack { code, side: blue }
  A-->>B: gửi mã phòng ngoài hệ thống (chat, ...)
  B->>S: room:join { code }
  S-->>B: ack { code, side: red }
  S-->>A: room:state
  S-->>B: room:state

  A->>S: room:ready { army }
  S->>F: kiểm tra lại phiên
  S->>S: armySchema + validateArmy theo CMS
  S-->>A: ack { ok: true }
  B->>S: room:ready { army }
  S->>F: kiểm tra lại phiên
  S-->>B: ack { ok: true }
  Note over S: phase = battle<br/>seed = crypto.randomInt<br/>tạo BattleRecord (armies, players, tick tối đa)
  S-->>A: battle:start { seed, mapId, budget, armies, configVersion }
  S-->>B: battle:start { seed, mapId, budget, armies, configVersion }

  loop mỗi 30 tick (1 giây mô phỏng)
    A->>S: battle:checksum { tick, hash }
    B->>S: battle:checksum { tick, hash }
    alt hash khớp
      S->>S: verified.add(tick)
    else hash khác
      S->>S: desync = true
      S-->>A: battle:desync { tick }
      S-->>B: battle:desync { tick }
    end
  end

  A->>S: battle:end { outcome: win, tick: 1830 }
  Note over S: lưu báo cáo của blue<br/>phase = lobby, reset ready<br/>chờ báo cáo của red
  S-->>A: room:state
  S-->>B: room:state
  B->>S: battle:end { outcome: lose, tick: 1830 }
  S->>S: judgeMatch: win/lose, cùng tick, không desync, đủ checksum
  S->>F: matches.add(...)
  S-->>A: battle:result { ok: true, winner: blue }
  S-->>B: battle:result { ok: true, winner: blue }
```

### 3.4 Vòng đời phòng và trận

`phase` quyết định có được xếp quân/sẵn sàng hay không; `battle` là bản ghi trận, tồn tại độc lập đến khi được lưu hoặc hủy. Người báo kết thúc trước có thể quay về xếp quân ngay, trong khi người kia vẫn xem nốt trận (ví dụ đang chạy 0.25×).

```mermaid
stateDiagram-v2
  [*] --> lobby: room:create
  lobby --> lobby: join / settings / ready / unready
  lobby --> battle: cả hai ready và connected (battle:start, tạo BattleRecord)
  battle --> cho_ben_con_lai: bên đầu tiên gửi battle:end (phase = lobby)
  cho_ben_con_lai --> lobby: bên còn lại gửi battle:end, xét kết quả
  battle --> lobby: một người rời trước khi báo (hủy kết quả)
  cho_ben_con_lai --> lobby: bên chưa báo rời phòng hoặc bấm sẵn sàng trận mới (hủy kết quả)
  lobby --> cho_xoa: cả hai mất kết nối
  cho_xoa --> lobby: có người vào lại trong 60 giây
  cho_xoa --> [*]: sau 60 giây, xóa khỏi RAM
```

### 3.5 Rớt mạng và vào lại

```mermaid
sequenceDiagram
  participant A as Client A
  participant S as Server
  participant B as Client B

  Note over A: mất kết nối
  S->>S: disconnect: socketId = null, ready = false
  alt đang có trận và A chưa báo kết thúc
    S-->>B: battle:result { ok: false, error: "A rời trận, kết quả bị hủy" }
  end
  S-->>B: room:state (A connected = false)
  Note over A: socket.io-client tự reconnect (handshake + cookie lại từ đầu)
  A->>S: room:join { code }
  S->>S: uid của A đã có chỗ trong phòng, trả lại đúng side và đội hình cũ
  S-->>A: ack { code, side }
  S-->>A: room:state
  S-->>B: room:state
```

- Chỗ ngồi gắn `uid`, không còn token trong `sessionStorage`. Người khác không chiếm được chỗ, và một người không tự vào chỗ `red` trong phòng của mình.
- Trạng thái phòng chỉ nằm trong RAM: **khởi động lại server là mất mọi phòng và trận đang chờ xác nhận**.

### 3.6 Xác nhận kết quả trận

Mỗi client báo kết quả **theo góc nhìn của mình** (`win` / `lose` / `draw`) kèm tick kết thúc. Server chỉ xét khi **đủ báo cáo của cả hai bên** ([src/server/matches.ts](../src/server/matches.ts), `judgeMatch`):

```mermaid
flowchart TD
  E["Đủ battle:end của blue và red"] --> D{"Có desync?"}
  D -- "có" --> X1["HỦY: Hai máy lệch trận"]
  D -- "không" --> T{"Cùng tick kết thúc?"}
  T -- "không" --> X2["HỦY: kết thúc ở thời điểm khác nhau"]
  T -- "có" --> C{"Đủ checksum khớp cho mọi tick 30, 60, ... ≤ tick kết thúc?"}
  C -- "thiếu" --> X3["HỦY: thiếu checksum"]
  C -- "đủ" --> O{"Cặp outcome (blue/red)"}
  O -- "win/lose" --> W1["LƯU: blue thắng"]
  O -- "lose/win" --> W2["LƯU: red thắng"]
  O -- "draw/draw" --> W3["LƯU: hòa"]
  O -- "win/win" --> X4["HỦY: cả hai cùng báo thắng"]
  O -- "lose/lose" --> X5["HỦY: cả hai cùng báo thua"]
  O -- "draw + win/lose" --> X6["HỦY: một bên hòa, một bên thắng/thua"]
  W1 & W2 & W3 --> S[("Firestore matches.add")]
  S -- "lỗi ghi" --> X7["battle:result ok=false: không lưu được"]
  S -- "ok" --> R["battle:result ok=true, winner"]
```

Các trường hợp hủy khác (không chờ đủ hai báo cáo):

| Tình huống | Kết quả |
| --- | --- |
| Người chưa báo kết thúc rời phòng / mất kết nối | hủy, báo bên còn lại |
| Người chưa báo kết thúc bấm sẵn sàng cho trận mới | hủy (bỏ dở trận) |
| `battle:end` sai định dạng (outcome lạ, tick ngoài 1..tick tối đa) | hủy |
| Báo cáo thứ hai của cùng một bên | bỏ qua (chỉ nhận lần đầu) |

Tài liệu `matches/{autoId}` lưu:

| Trường | Ý nghĩa |
| --- | --- |
| `room`, `seed`, `mapId`, `budget`, `configVersion` | tham số trận do **server** giữ, không lấy từ client lúc kết thúc |
| `useStars`, `stars.blue/red` | có tính sao không và sao của từng loại lính mỗi bên (server đọc từ ví) |
| `players.blue/red` | `{ uid, name }` |
| `armies.blue/red` | đội hình đã được server kiểm tra, đủ để chạy lại trận |
| `winner` | `blue` / `red` / `draw` |
| `endTick` | tick kết thúc hai bên cùng báo |
| `startedAt`, `endedAt` | thời điểm bắt đầu (server) và lưu (`serverTimestamp`) |

Firestore rules không mở `matches` cho client (mặc định cấm): chỉ server ghi bằng Admin SDK.

### 3.7 Lớp bảo vệ Socket.IO

```mermaid
flowchart TD
  H["WebSocket upgrade /socket.io"] --> O{"allowRequest:<br/>Origin khớp Host / X-Forwarded-Host?"}
  O -- "không" --> R1["từ chối handshake"]
  O -- "có" --> SZ["maxHttpBufferSize 100 KB"]
  SZ --> AU{"io.use: cookie sb_session<br/>verifySessionCookie(checkRevoked)<br/>user tồn tại, không bị khóa?"}
  AU -- "không" --> R2["connect_error: unauthorized"]
  AU -- "có" --> ONE["Mỗi uid một kết nối:<br/>kết nối cũ bị ngắt"]
  ONE --> PK["socket.use cho mỗi gói tin"]
  PK --> RL{"> 20 sự kiện / giây?"}
  RL -- "có" --> R3["ngắt kết nối"]
  RL -- "không" --> ACK{"Sự kiện cần ack mà thiếu callback?"}
  ACK -- "có" --> R4["bỏ gói tin"]
  ACK -- "không" --> HD["handler: zod + kiểm tra phase, side, chủ phòng"]
  HD --> RD{"room:ready?"}
  RD -- "có" --> RV["kiểm tra lại phiên với Firebase<br/>(user bị khóa giữa chừng bị ngắt)"]
```

| Lớp | Chặn cái gì |
| --- | --- |
| Origin check | trang web lạ mở WebSocket tới server bằng trình duyệt của nạn nhân (Cross-Site WebSocket Hijacking) |
| Cookie phiên + `checkRevoked` + `disabled` | khách vô danh, cookie giả, tài khoản bị khóa hoặc đã bị thu hồi phiên |
| Kiểm tra lại phiên ở `room:ready` | tài khoản bị khóa trong lúc đang kết nối tiếp tục mở trận mới |
| Một kết nối mỗi `uid` | một tài khoản mở nhiều socket để tạo hàng loạt phòng, hoặc tự đấu với chính mình |
| Rate limit 20 sự kiện/giây, gói ≤ 100 KB | spam sự kiện, gói tin khổng lồ |
| Bỏ gói thiếu ack | **một gói `room:join` không có callback làm sập cả tiến trình Node** (lỗi đã xác nhận trước khi sửa: `TypeError: ack is not a function`) |
| zod + phase/side/chủ phòng | payload sai kiểu, gửi sự kiện sai thời điểm, người không phải chủ phòng đổi map |
| `validateArmy` trên server | đội hình vượt ngân sách, ngoài vùng, lính không tồn tại |
| Kiểm tra ví ở `room:ready` | dùng lính chưa mở khóa, tự khai sao (sao chỉ lấy từ Firestore, không nhận từ client) |
| Seed do server sinh, đội hình do server gửi | client tự chọn seed hoặc đổi đội hình sau khi đối thủ sẵn sàng |
| Checksum đối chiếu, tick hợp lệ, chỉ nhận lần đầu | client sửa đổi làm lệch trận, gửi checksum rác để làm phình bộ nhớ |
| Đồng thuận hai bên khi lưu kết quả | một client gian lận tự khai thắng |

**Giới hạn còn lại:** hai người **thông đồng** vẫn khai được kết quả tùy ý (cả hai cùng sửa client). Người sắp thua có thể **thoát trước khi trận kết thúc** để hủy kết quả thay vì nhận thua. Muốn chặn cả hai thì server phải tự chạy lại trận từ `seed` + `armies` (mô phỏng tất định nên làm được, nên chạy trong `worker_threads`); `matches` đã lưu đủ dữ liệu để làm việc này sau.

---

## 4. Cơ chế phân quyền

### 4.1 Vai trò

Lưu ở Firestore `users/{uid}.role` ([src/shared/users.ts](../src/shared/users.ts)):

| Giá trị | Vai trò | Quyền |
| --- | --- | --- |
| `0` | Root | toàn quyền CMS, quản lý mọi user khác (kể cả root/admin khác), cấp mọi vai trò |
| `1` | Admin | toàn quyền nội dung CMS + Xưởng; chỉ quản lý user role `2`; chỉ cấp role `2` |
| `2` | Người dùng | chơi mọi chế độ kể cả online (kết quả lưu theo `uid`), đăng ký FCM token, có ví coin (hộp quà, mở khóa, mua thẻ, nâng sao); không vào `/admin` |
| — | Khách (chưa đăng nhập) | chơi với máy, 2 người 1 máy **chỉ với lính miễn phí** (`unlockCost = 0`), xem `/models`, đọc `/api/config`; **không** đấu online, không có ví |

Quy tắc (hàm thuần, dùng chung):

- `canAccessCms(user)`: đăng nhập, không bị khóa, `role <= 1`.
- `canManage(actor, target)`: không tự sửa chính mình; root quản lý tất cả; người khác chỉ quản lý người có `role` lớn hơn (thấp quyền hơn).
- `assignableRoles(actor)`: root cấp `0,1,2`; admin chỉ cấp `2`.
- Root đầu tiên: email trong `FIREBASE_ROOT_EMAILS` **và đã xác minh** (`emailVerified`) → mỗi lần đăng nhập được đặt `role = 0`.

### 4.2 Luồng xác thực

```mermaid
sequenceDiagram
  autonumber
  participant U as Trình duyệt
  participant FA as Firebase Auth
  participant N as Next.js /api/auth/session
  participant FS as Firestore users

  U->>FA: signIn (email/mật khẩu hoặc Google)
  FA-->>U: idToken (JWT ngắn hạn)
  U->>N: POST { idToken } (Content-Type: application/json)
  N->>FA: verifyIdToken(idToken, checkRevoked = true)
  N->>FS: transaction: tạo hồ sơ (role 2 hoặc 0 nếu root email đã xác minh) / cập nhật
  alt user.disabled
    N-->>U: 403 Tài khoản đã bị khoá
  else
    N->>FA: createSessionCookie(idToken, 14 ngày)
    N-->>U: Set-Cookie sb_session (httpOnly, SameSite=Lax, Secure khi production)
  end

  Note over U,N: Các request sau
  U->>N: request /api/admin/* hoặc trang /admin (kèm cookie)
  N->>FA: verifySessionCookie(cookie, checkRevoked = true)
  N->>FS: getUser(uid) — đọc role, disabled mới nhất
  N-->>U: 401 / 403 / dữ liệu
```

### 4.3 Kiểm tra quyền trên từng lớp

```mermaid
flowchart TD
  R["Request"] --> T{"Loại"}
  T -- "trang /admin/(panel)/*" --> L["layout.tsx: cmsUser()"]
  L -- "null" --> RL["redirect /admin/login"]
  L -- "root/admin" --> P["render trang"]

  T -- "/api/admin/{collection}, settings, bundle, studio" --> G["guard() = requireCms()"]
  G -- "không cookie / cookie sai / bị khóa" --> E401["401 Chưa đăng nhập"]
  G -- "role 2" --> E403["403 Chỉ root/admin"]
  G -- "ok" --> V["readJson (bắt buộc application/json)<br/>zod schema<br/>kiểm tra tham chiếu"] --> W["ghi Firestore / SQLite"]

  T -- "/api/admin/users/{uid} PATCH, DELETE" --> M["requireManageable(uid)<br/>requireCms + canManage"]
  M -- "tự sửa mình / target quyền ≥ actor" --> E403b["403"]
  M -- "ok" --> RA{"đổi role?"}
  RA -- "role không nằm trong assignableRoles" --> E403c["403 vượt quyền"]
  RA -- "ok" --> UW["cập nhật Auth + Firestore<br/>revokeRefreshTokens nếu khóa / đổi mật khẩu / hạ quyền"]

  T -- "/api/auth/fcm, /api/player POST" --> CU["currentUser() bất kỳ user đăng nhập"]
  T -- "/api/admin/users/{uid}/wallet POST" --> M
  T -- "Socket.IO /socket.io" --> SIO["Origin check + verifySessionCookie<br/>user bị khóa bị từ chối (xem 3.7)"]
  T -- "/api/config" --> PUB["công khai, không xác thực"]

  FSR["Firestore rules (client SDK)"] --> FR["users/{uid}: chỉ đọc hồ sơ của chính mình<br/>ghi: cấm<br/>players/** (ví, ledger): cấm cả chủ ví<br/>nội dung CMS, matches: không có rule, mặc định cấm"]
```

Ma trận quyền theo endpoint:

| Endpoint | Khách | User (2) | Admin (1) | Root (0) |
| --- | --- | --- | --- | --- |
| `GET /api/config` | ✓ | ✓ | ✓ | ✓ |
| Socket.IO `/socket.io` (PvP) | ✗ | ✓ | ✓ | ✓ |
| `GET/POST/DELETE /api/auth/session` | ✓ | ✓ | ✓ | ✓ |
| `POST /api/auth/fcm` | ✗ | ✓ | ✓ | ✓ |
| `GET /api/player` | ✓ (trả `player: null`) | ✓ ví của mình | ✓ | ✓ |
| `POST /api/player` (mở hộp, mở khóa, nâng sao, mua thẻ) | ✗ | ✓ ví của mình | ✓ | ✓ |
| `GET /api/fonts/clash` | ✓ | ✓ | ✓ | ✓ |
| Trang `/admin/*` | ✗ | ✗ | ✓ | ✓ |
| `/api/admin/{collection}[/{id}]`, `settings`, `bundle` | ✗ | ✗ | ✓ | ✓ |
| `/api/admin/studio/**` (gọi Claude, tốn chi phí) | ✗ | ✗ | ✓ | ✓ |
| `GET /api/admin/users[/{uid}]` | ✗ | ✗ | ✓ (xem tất cả) | ✓ |
| `POST /api/admin/users` | ✗ | ✗ | chỉ tạo role 2 | mọi role |
| `PATCH/DELETE /api/admin/users/{uid}` | ✗ | ✗ | chỉ target role 2, không phải mình | mọi target trừ mình |
| `POST /api/admin/users/{uid}/notify` | ✗ | ✗ | ✓ (mọi user) | ✓ |
| `GET /api/admin/users/{uid}/wallet` | ✗ | ✗ | ✓ (mọi user) | ✓ |
| `POST /api/admin/users/{uid}/wallet` (cộng/trừ coin) | ✗ | ✗ | chỉ target role 2, không phải mình | mọi target trừ mình |

---

## 5. Bảo mật

### 5.1 Các biện pháp đang có

**Xác thực, phiên**

- Phiên dùng Firebase **session cookie** `sb_session`: `httpOnly` (JS không đọc được), `SameSite=Lax`, `Secure` ở production, tối đa 14 ngày.
- `verifyIdToken` và `verifySessionCookie` đều bật `checkRevoked`. Khóa user, đổi mật khẩu hoặc hạ quyền sẽ gọi `revokeRefreshTokens`, nên cookie cũ mất hiệu lực ngay.
- Mỗi request HTTP (và mỗi handshake Socket.IO) đọc lại hồ sơ Firestore, nên đổi `role`/`disabled` áp dụng tức thì, không phụ thuộc token cũ.
- Root bootstrap chỉ nhận **email đã xác minh**, tránh việc tạo tài khoản email/mật khẩu chưa xác minh trùng email root.

**Chống CSRF**

- Cookie `SameSite=Lax`: request cross-site bằng `fetch`/form POST không kèm cookie.
- `readJson` bắt buộc `Content-Type: application/json` cho mọi thao tác ghi, chặn form HTML cross-site (form không gửi được JSON content type mà không qua preflight CORS).
- WebSocket: kiểm tra `Origin` khi handshake (xem 3.7).

**Kiểm tra dữ liệu vào**

- Mọi payload API và Socket.IO đi qua **zod** (`COLLECTION_SCHEMAS`, `settingsSchema`, `armySchema`, `createUserSchema`, ...). Không đổi được `id` qua PUT.
- Kiểm tra tham chiếu chéo (`findRefIssues`) khi tạo/sửa/nhập, chặn xóa khi còn phụ thuộc (`findDependents`).
- Tài liệu Firestore sửa tay sai schema bị bỏ qua và ghi log, không làm hỏng game.
- Giới hạn kích thước: ảnh Xưởng ≤ 12 MB dạng data URL PNG/JPEG/WebP/GIF, sheet review ≤ 8 MB, prompt ≤ 4000 ký tự, idToken ≤ 4096, gói Socket.IO ≤ 100 KB.

**Firestore**

- Client SDK chỉ đọc được `users/{uid}` của chính mình; mọi ghi đi qua server (Admin SDK). Collection nội dung và `matches` không có rule nên client bị chặn mặc định; game đọc nội dung qua `/api/config`.
- Service account chỉ nằm ở biến môi trường server (`FIREBASE_SERVICE_ACCOUNT`), không có tiền tố `NEXT_PUBLIC_`.

**PvP online** — chi tiết ở [3.6](#36-xác-nhận-kết-quả-trận) và [3.7](#37-lớp-bảo-vệ-socketio)

- Bắt buộc đăng nhập, kiểm tra Origin, một kết nối mỗi tài khoản, rate limit, giới hạn kích thước gói, bỏ gói thiếu ack.
- Server là nguồn chuẩn cho **luật xếp quân** (`validateArmy` với dữ liệu CMS trên server), **seed** (`crypto.randomInt`) và **tham số trận** lưu vào `matches`.
- Kết quả chỉ lưu khi hai bên báo khớp (win/lose hoặc draw/draw), cùng tick, không desync, đủ checksum; còn lại hủy.
- Đội hình đối thủ không lộ trong lobby; chỉ chủ phòng đổi map/ngân sách và mọi thay đổi reset sẵn sàng.
- `configVersion` (hash SHA-1 của nội dung) giúp phát hiện hai máy dùng dữ liệu CMS khác nhau.

**Ví coin** — chi tiết ở [mục 6](#6-tiền-tệ-thẻ-bài-hộp-quà)

- Chỉ server đọc/ghi `players/**` (Admin SDK); rules cấm client kể cả chủ ví; game đọc ví qua `/api/player`.
- Mỗi thay đổi là một **Firestore transaction**: đọc lại ví, áp luật thuần, ghi ví + dòng ledger cùng lúc. Hai request đồng thời không tiêu trùng coin và không mở một hộp hai lần.
- Client chỉ gửi ý định (`open-box`, `unlock`, `upgrade`, `buy-cards` + `unitId`, `count` 1–1000). Giá, phần thưởng (`crypto.randomInt`), giờ mở hộp (đồng hồ server, ngày theo giờ Việt Nam) đều tính ở server.
- Số coin nguyên, không âm; dữ liệu ví sai schema bị từ chối (không reset về 0).
- Admin cộng/trừ coin theo luật `canManage` (không tự cộng cho mình, admin chỉ với user role 2), bắt buộc ghi lý do, ledger lưu `by` = uid admin.
- Sao và lính đã mở khóa trong đấu online lấy từ ví trên server.

**Xưởng img2threejs (AI)**

- Claude **chỉ trả JSON sculpt spec**, không trả code. Spec được parse bằng schema và dựng bởi generator tin cậy trong [src/game/sculpt](../src/game/sculpt/); không có `eval`/`new Function` nào chạy nội dung AI.
- CLI chạy với `--safe-mode --tools ""` (không tool, không đọc CLAUDE.md/hook/MCP), `cwd` là thư mục tạm, không lưu session.
- `ANTHROPIC_API_KEY` chỉ ở server. Chỉ root/admin gọi được Xưởng.

**Khác**

- Nội dung do người dùng nhập (tên hiển thị) render qua React nên được escape tự động.

### 5.2 Đã xử lý

| Vấn đề trước đây | Cách xử lý | Kiểm chứng |
| --- | --- | --- |
| **Sập server bằng một gói tin:** `room:join`/`room:create`/`room:ready` không kèm ack làm handler ném `TypeError: ack is not a function`, tiến trình Node thoát | `socket.use` bỏ các gói thiếu callback | đã tái hiện lỗi trước khi sửa; test `a packet without its ack callback is dropped...` |
| Socket.IO không xác thực | handshake bắt buộc cookie phiên hợp lệ, user không bị khóa; kiểm tra lại ở `room:ready` | test handshake + chạy thử server thật: không cookie / cookie giả → `unauthorized` |
| Không giới hạn origin cho WebSocket | `allowRequest` so `Origin` với `Host` / `X-Forwarded-Host` | test + server thật: origin lạ bị từ chối |
| Không rate limit sự kiện socket, gói tối đa 1 MB | 20 sự kiện/giây mỗi socket (vượt thì ngắt), `maxHttpBufferSize` 100 KB, mỗi `uid` một kết nối | test `flooding events...`, `a second connection...` |
| Kết quả trận do một client quyết định | đồng thuận hai bên + cùng tick + không desync + đủ checksum; lưu Firestore `matches` | `matches.test.ts` (luật) và `rooms.test.ts` (luồng thật: lưu, cùng báo thắng, desync, rời trận) |
| Token vào lại phòng lưu `sessionStorage` | bỏ token, chỗ ngồi gắn `uid` | test `joining your own room gives your seat back...` |
| Checksum giới hạn bằng cách xóa mục cũ (có thể mất dữ liệu đối chiếu) | chỉ nhận tick là bội số của 30 trong giới hạn thời gian trận, mỗi tick một lần | `rooms.test.ts` |

### 5.3 Rủi ro còn lại

Xếp theo mức độ ưu tiên khuyến nghị. Đây là nhận định từ đọc code và test, chưa pentest.

| # | Mức | Vấn đề | Chi tiết | Hướng xử lý gợi ý |
| --- | --- | --- | --- | --- |
| 1 | Trung bình | **Thông đồng và thoát trận để né thua** | Hai client cùng sửa đổi khai được kết quả bất kỳ. Người sắp thua ngắt kết nối trước khi trận kết thúc thì kết quả bị hủy thay vì ghi thua. | Server chạy lại trận từ `seed` + `armies` trong `worker_threads` để ra kết quả chuẩn; hoặc xử thua người rời trận khi checksum đến lúc rời vẫn khớp. |
| 2 | Trung bình | **Chưa giới hạn theo IP / tổng số phòng** | Mỗi tài khoản chỉ một kết nối, nhưng nhiều tài khoản (tạo tự do bằng email) vẫn tạo được nhiều phòng. Handshake gọi Firebase cho mỗi lần kết nối. | Giới hạn kết nối theo IP ở reverse proxy, giới hạn tổng số phòng, bắt buộc xác minh email. |
| 3 | Thấp–TB | **Không có security header** | Chưa đặt CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, HSTS trong [next.config.ts](../next.config.ts). `/admin` có thể bị nhúng iframe (clickjacking). | Thêm `headers()` trong Next config hoặc ở reverse proxy. |
| 4 | Thấp–TB | **Không rate limit API HTTP** | `/api/auth/session` và các route admin không giới hạn tốc độ. Xưởng có thể bị gọi dồn gây tốn chi phí Claude nếu tài khoản admin bị lộ. | Rate limit theo IP/uid ở reverse proxy hoặc middleware; giới hạn số job chạy song song. |
| 5 | Thấp | **Guard nằm rải rác trong từng route** | Không có `middleware`/`proxy` chung cho `/api/admin/*`; route mới quên gọi `guard()` sẽ mở công khai. | Thêm middleware kiểm tra cookie cho `/api/admin` (lớp 1) và giữ `guard()` (lớp 2); thêm test liệt kê route. |
| 6 | Thấp | **Root theo biến môi trường luôn được nâng lại** | Email trong `FIREBASE_ROOT_EMAILS` được đặt `role = 0` **mỗi lần đăng nhập**; hạ quyền trong CMS sẽ bị hoàn tác. Nếu tài khoản Google đó bị chiếm, không hạ quyền được bằng CMS (chỉ khóa `disabled` được, và chỉ root khác làm được). | Gỡ email khỏi biến môi trường sau khi bootstrap. |
| 7 | Thấp | **Admin gửi thông báo tới mọi user** | `notify` chỉ dùng `requireCms`, không dùng `canManage`: admin gửi được push tới root/admin khác. `GET /api/admin/users` trả cả `fcmTokens` cho admin. | Dùng `requireManageable` cho notify; ẩn `fcmTokens` trong response danh sách. |
| 8 | Thấp | **Lộ `e.message` của lỗi không xác định** | `firebaseErrorResponse` và stream Xưởng trả thông điệp lỗi gốc cho client (chỉ root/admin thấy). | Log chi tiết ở server, trả thông báo chung ở production. |
| 9 | Vận hành | **Trạng thái phòng chỉ trong RAM, một instance** | Restart/deploy làm mất mọi phòng và trận đang chờ xác nhận; không scale ngang được. Map "một kết nối mỗi uid" cũng chỉ đúng trong một instance. | Redis adapter + sticky session + khóa phân tán nếu cần nhiều instance. |
| 10 | Vận hành | **Engine CLI dùng login `claude` của máy chủ** | Tài khoản Claude của người vận hành gắn với server; ai chiếm được quyền admin CMS là dùng được quota đó. | Ưu tiên `ANTHROPIC_API_KEY` riêng có giới hạn chi tiêu ở production. |
| 11 | Trung bình | **Chưa rate limit `/api/player`** | Mỗi request là một transaction Firestore (tốn phí đọc/ghi); spam request không làm sai số dư nhưng tăng chi phí. | Rate limit theo uid/IP ở reverse proxy hoặc middleware. |
| 12 | Trung bình | **Admin là người cộng coin** | Chưa có cổng thanh toán: admin bị lộ tài khoản có thể cộng coin cho user khác (vẫn để lại dấu vết ledger). | Cổng thanh toán có webhook ký (MONETIZATION.md), báo cáo ledger `admin`, giới hạn số coin mỗi lần cộng. |
| 13 | Thấp | **Đấu với máy tính sao trên client** | Chế độ đấu máy không có phần thưởng, client sửa được sao của mình. | Không cần xử lý tới khi đấu máy có thưởng; khi đó chạy lại trận trên server. |
| 14 | Pháp lý | **Chưa đủ điều kiện thu tiền thật** | Chưa có giấy phép G1, chưa xác thực số điện thoại, chưa giới hạn giờ chơi người dưới 18 tuổi. | Xem [MONETIZATION.md mục 5](MONETIZATION.md#5-pháp-lý-tại-việt-nam). |

### 5.4 Checklist triển khai production

- [ ] `NODE_ENV=production` (bật cookie `Secure`), chạy sau HTTPS.
- [ ] `FIREBASE_SERVICE_ACCOUNT` đặt qua secret manager, không commit `.env`.
- [ ] Triển khai [firestore.rules](../firestore.rules) lên Firebase (không mở `matches`, `players` cho client).
- [ ] Bật provider Email/Password + Google; cân nhắc bắt buộc xác minh email.
- [ ] Sau khi có root: xóa email khỏi `FIREBASE_ROOT_EMAILS` (rủi ro 6).
- [ ] Reverse proxy: **giữ nguyên `Host` hoặc gửi `X-Forwarded-Host`** (không thì Origin check chặn mọi kết nối online), hỗ trợ WebSocket upgrade, rate limit, security header, giới hạn kích thước body.
- [ ] `ANTHROPIC_API_KEY` riêng, đặt giới hạn chi tiêu.
- [ ] Sao lưu Firestore định kỳ, **đặc biệt `players` (ví coin)** — bundle JSON của CMS không chứa ví; và file SQLite `data/game.db`.
- [ ] Đặt giá cho lính trên Firestore đang có dữ liệu: Tổng quan CMS → *Nội dung mặc định mới* → *Đặt giá…* (hoặc sửa từng lính ở `/models`, tab Thẻ & sao).
- [ ] Chạy một instance (hoặc thêm Redis adapter trước khi scale).

---

## 6. Tiền tệ, thẻ bài, hộp quà

### 6.1 Dữ liệu

| Nơi | Trường | Ý nghĩa |
| --- | --- | --- |
| `units/{id}` (CMS, sửa ở `/models` tab 🃏 Thẻ & sao) | `unlockCost` | coin để mở khóa; `0` = miễn phí cho mọi người, kể cả khách |
| | `cardPrice` | giá 1 thẻ; `0` = không bán |
| | `starCards[5]`, `starCoins[5]` | thẻ và coin **dùng hết** để lên sao 1…5 (mặc định 100/200/300/400/500 thẻ, 1.000/2.000/4.000/8.000/16.000 coin) |
| `settings/global.economy` (CMS Cài đặt) | `boxHours` | x của hộp x giờ (mặc định 3) |
| | `starBonus` | máu và sát thương tăng mỗi sao (mặc định 0,1 = +10%) |
| | `dailyBox`, `hourlyBox` | kiểu rương, coin `[min, max]`, tổng số thẻ, số loại lính |
| `players/{uid}` (chỉ server) | `coins` | số coin (1 coin = 1 VNĐ), nguyên, không âm |
| | `cards`, `stars`, `unlocked` | thẻ chưa dùng theo lính, sao 0–5 theo lính, lính đã mua |
| | `dailyDay`, `lastBoxAt` | ngày (giờ Việt Nam) mở hộp hằng ngày gần nhất, thời điểm mở hộp gần nhất |
| `players/{uid}/ledger/{autoId}` | `type`, `coins`, `balance`, `cards`, `unitId`, `star`, `note`, `by`, `at` | sổ giao dịch chỉ ghi thêm: `daily-box`, `hourly-box`, `unlock`, `upgrade`, `buy-cards`, `admin` |

Firestore đang có dữ liệu cũ đọc lính với `unlockCost = 0`, `cardPrice = 0` (mọi lính miễn phí, không bán thẻ) và `economy` mặc định. Không tự migrate: panel *Nội dung mặc định mới* trên Tổng quan có tùy chọn đặt giá mặc định cho các lính mặc định chưa có giá.

### 6.2 Luật

Luật thuần ở [economy.ts](../src/shared/economy.ts), có test ([economy.test.ts](../src/shared/economy.test.ts)):

- **Hộp hằng ngày:** mỗi ngày theo giờ Việt Nam (UTC+7) một hộp, sang ngày mới lúc 0h.
- **Hộp x giờ:** chỉ xuất hiện khi hôm nay đã mở hộp hằng ngày; mở được khi đã qua `boxHours` giờ kể từ hộp mở gần nhất (hằng ngày hoặc x giờ). Không cộng dồn lượt. Ngày mới phải mở hộp hằng ngày trước.
- **Phần thưởng:** coin đều trong `[min, max]`; `cards` thẻ chia cho `kinds` loại lính khác nhau, lính rẻ dễ ra hơn (trọng số 1/√giá). Thẻ của lính chưa mở khóa vẫn được cộng.
- **Mở khóa:** trả `unlockCost`. **Mua thẻ:** lính đã mở khóa, `cardPrice > 0`. **Nâng sao:** lính đã mở khóa, dùng hết `starCards[sao]` thẻ và `starCoins[sao]` coin, tối đa 5 sao.
- **Sao trong trận:** máu, sát thương giẫm đạp, sát thương và sát thương cháy của mọi đòn/kỹ năng × `1 + starBonus × sao` ([world.ts](../src/game/sim/world.ts), chỉ `+ - * /` nên online không lệch). Đấu với máy: sao của người chơi cho phe Xanh, bot không có sao. 2 người 1 máy: không tính sao. Online: chủ phòng bật/tắt (mặc định bật).

### 6.3 Luồng mở hộp

```mermaid
sequenceDiagram
  autonumber
  participant U as Trình duyệt (HomeMenu)
  participant S as /api/player
  participant FS as Firestore

  U->>S: GET /api/player
  S->>FS: players/{uid}
  S-->>U: { player, boxes: { daily, hourly }, now }
  Note over U: đếm ngược theo giờ server (now), rương nhún nhảy khi mở được
  U->>S: POST { action: "open-box", kind: "daily" }
  Note over U: rương rung trong lúc chờ
  S->>S: currentUser() từ cookie phiên
  S->>FS: runTransaction: đọc players/{uid}
  S->>S: openBox(): kiểm ngày/giờ, crypto.randomInt → coin + thẻ
  S->>FS: ghi players/{uid} + ledger (cùng transaction)
  S-->>U: { player, boxes, reward, now }
  Note over U: nắp bật, ánh sáng, thẻ bài bay ra
```

Mở hộp lần hai trong ngày, nâng sao thiếu thẻ, mua thiếu coin… trả `409` kèm thông báo; không ghi gì.

### 6.4 Giao diện

| Chỗ | Nội dung |
| --- | --- |
| Góc trên phải `/` và `/play` (trừ lúc đang đánh) | avatar (ảnh tài khoản hoặc DiceBear `clay` theo uid), tên, thanh coin; bấm avatar: CMS (admin), đăng xuất |
| Góc dưới trái `/` | hộp quà hằng ngày, hộp x giờ (sau khi mở hộp hằng ngày), bộ sưu tập thẻ |
| Màn mở hộp | [ChestStage](../src/components/player/ChestStage.tsx): rương idle nhún nhảy + lắc lư, rung khi chờ server, nắp bật theo bản lề, quầng sáng, cột sáng, tia sáng xoay, hạt lấp lánh; sau đó coin và thẻ bài bật ra |
| Bộ sưu tập thẻ | thẻ kiểu Clash Royale (khung xanh sọc, giọt chi phí, tấm gỗ tên, sao, thanh thẻ `có/cần`), khóa + giá; chi tiết: chỉ số trước/sau khi lên sao, mở khóa / nâng sao / mua 10–50 thẻ (bấm hai lần để xác nhận trừ coin) |
| Bảng lính khi xếp quân | lính chưa mở khóa mờ + ổ khóa, không đặt được, "Ngẫu nhiên" chỉ dùng lính đã có; hiện số sao khi sao được tính |
| `/models` | tab 🃏 Thẻ & sao cho từng lính (có thẻ xem trước); mục Hộp quà xem 6 kiểu rương và *Mở thử* |
| CMS `/admin/users/{uid}` | ví, lính đã mua, sao, sổ giao dịch 50 dòng gần nhất, cộng/trừ coin có lý do |

Font: mọi màn game (không gồm `/admin` và `/models`) dùng lớp `.game-ui`: font Clash từ `data/Clash_Regular.otf.ttf` (phục vụ qua `/api/fonts/clash`, thay file là có hiệu lực, thiếu file thì dùng font dự phòng), chữ màu `#2D3232`, cỡ tối thiểu 16px (`text-xs`/`text-sm` = 16px trong `.game-ui`). File Clash hiện thiếu phần lớn chữ tiếng Việt có dấu chồng (ơ ư ạ ả ấ ầ…), các chữ đó lấy từ Paytone One cho tới khi có bản Clash tiếng Việt.

---

## 7. Phụ lục: bảng API

| Method | Đường dẫn | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/api/config` | công khai | bundle nội dung + `version` cho game |
| GET | `/api/auth/session` | công khai | hồ sơ hiện tại hoặc `null` |
| POST | `/api/auth/session` | công khai (cần idToken hợp lệ) | đổi idToken lấy cookie phiên, tạo/cập nhật hồ sơ |
| DELETE | `/api/auth/session` | công khai | xóa cookie phiên |
| POST | `/api/auth/fcm` | user đăng nhập | lưu FCM token của thiết bị |
| GET | `/api/player` | công khai (`player: null` khi chưa đăng nhập) | ví của mình + trạng thái hộp quà + giờ server |
| POST | `/api/player` | user đăng nhập | `{action:"open-box", kind}` / `{action:"unlock"\|"upgrade", unitId}` / `{action:"buy-cards", unitId, count}`; trả ví mới (+ `reward` khi mở hộp) |
| GET | `/api/fonts/clash` | công khai | file font `data/Clash_Regular.otf.ttf` (404 khi thiếu) |
| GET / POST | `/api/admin/{collection}` | root/admin | liệt kê / tạo tài liệu |
| GET / PUT / DELETE | `/api/admin/{collection}/{id}` | root/admin | đọc / sửa / xóa (chặn khi còn phụ thuộc) |
| GET / PUT | `/api/admin/settings` | root/admin | cài đặt game |
| GET / PUT / POST | `/api/admin/bundle` | root/admin | tải bundle JSON / nhập thay toàn bộ / `{action:"reset"}` / `{action:"merge", docs, skills, prices}` thêm nội dung mặc định còn thiếu, gán kỹ năng / giá mặc định cho lính mặc định chưa có (không sửa mục khác) |
| GET / POST | `/api/admin/studio` | root/admin | trạng thái engine + danh sách job / tạo job |
| GET / DELETE | `/api/admin/studio/{id}` | root/admin | chi tiết job / xóa job (không khi đang chạy) |
| POST | `/api/admin/studio/{id}/run` | root/admin | chạy bước `spec` / `review` (stream NDJSON) hoặc `stop` |
| POST | `/api/admin/studio/codegen` | root/admin | sinh file TypeScript từ sculpt spec (version hoặc asset đã áp dụng) |
| GET / POST | `/api/admin/users` | root/admin | danh sách / tạo user (giới hạn role cấp được) |
| GET / PATCH / DELETE | `/api/admin/users/{uid}` | root/admin + `canManage` cho PATCH/DELETE | xem / sửa / xóa user (xóa cả ví `players/{uid}` và ledger) |
| POST | `/api/admin/users/{uid}/notify` | root/admin | gửi push FCM tới mọi thiết bị của user |
| GET | `/api/admin/users/{uid}/wallet` | root/admin | ví + trạng thái hộp + 50 dòng ledger gần nhất |
| POST | `/api/admin/users/{uid}/wallet` | root/admin + `canManage` | `{ delta, note }` cộng/trừ coin (không âm), ghi ledger `admin` |
| WS | `/socket.io` | user đăng nhập, cùng origin | PvP online, xem mục 3 |
