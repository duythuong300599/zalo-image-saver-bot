# Zalo Image Saver Bot

Bot Zalo (Bot Platform chính thức) nhận webhook, tải ảnh người dùng gửi vào `SAVE_DIR` ngay lập tức, và phản hồi kết quả cho người dùng.

Gửi nhiều ảnh liên tiếp (vd chọn cả album) vẫn lưu từng ảnh riêng biệt. Ảnh lưu thành công được gộp **1 tin nhắn tổng hợp** sau 2 giây im lặng cuối cùng (vd "Đã lưu 5 ảnh thành công ✅"). Ảnh lỗi thì bot **reply trực tiếp vào đúng ảnh đó** (tối đa 5 ảnh lỗi/batch — quá số này thì gộp lại thành 1 tin đếm số lượng để tránh spam) để bạn biết chính xác ảnh nào cần gửi lại.

Chat lần đầu (tin nhắn bất kỳ — text, ảnh, sticker...) sẽ nhận **1 tin nhắn chào mừng** giới thiệu bot, chỉ gửi đúng 1 lần cho mỗi `chatId` (lưu trạng thái trong `SAVE_DIR/.known-chats.json`, sống sót qua restart).

## 1. Tạo bot & lấy token

1. Mở app Zalo → tìm OA **"Zalo Bot Manager"**.
2. Chọn **"Tạo bot"** → **"Zalo Bot Creator"**.
3. Đặt tên bot (bắt buộc có tiền tố `"Bot"`) → **"Tạo Bot"**.
4. Token được gửi qua tin nhắn Zalo, dạng `123456789:abc-xyz...`. Copy vào `BOT_TOKEN`.

Tài liệu chính thức: https://docs.zaloplatforms.com/docs/BOT/create_bot

## 2. Local dev

```bash
cp .env.example .env
# Điền BOT_TOKEN; sinh WEBHOOK_SECRET ngẫu nhiên:
openssl rand -hex 32
npm ci
npm run dev
```

Zalo từ chối webhook trỏ về `localhost`/IP private → cần expose qua ngrok:

```bash
ngrok http 3000
WEBHOOK_URL=https://<ngrok-id>.ngrok-free.app/webhook npm run set-webhook
```

## 3. Set webhook

```bash
npm run set-webhook                # dùng WEBHOOK_URL trong .env
npm run set-webhook -- <url>       # hoặc truyền URL trực tiếp
npm run set-webhook -- --info      # xem webhook hiện tại
npm run set-webhook -- --delete    # xoá webhook (chuyển sang polling)
```

Script in ra `verification.ok` / `verification.hint`. Lưu ý:

- URL vẫn được Zalo lưu lại **dù verification thất bại** — kiểm tra `--info` để chắc chắn.
- Webhook và `getUpdates` (polling) loại trừ nhau.
- Đổi từ ngrok sang VPS (hoặc ngược lại) → phải `set-webhook` lại vì URL thay đổi.

## 4. Deploy (Docker Compose, qua Cloudflare Tunnel)

Server không có IP public (chỉ lộ qua Cloudflare Tunnel đã cài sẵn — `cloudflared` chạy
dạng systemd service, ingress rule cấu hình trên Cloudflare Zero Trust dashboard, không
phải file local). Vì vậy **không dùng Caddy/Let's Encrypt** — container publish port
thẳng ra host (`3002:3000`), Cloudflare lo phần TLS + routing public hostname.

**Lần đầu deploy (làm trên server):**
```bash
mkdir -p ~/zalo-image-saver-bot && cd ~/zalo-image-saver-bot
cp .env.example .env   # điền BOT_TOKEN, WEBHOOK_SECRET thật
sudo mkdir -p /mnt/ssd-images/zalo-bot-images && sudo chown 1000:1000 /mnt/ssd-images/zalo-bot-images
# copy docker-compose.yml từ repo vào đây (hoặc để GitHub Actions tự scp lên, xem bên dưới)
docker compose pull && docker compose up -d
```

**Route public hostname (làm 1 lần, trên Cloudflare Zero Trust dashboard):**
Networks → Tunnels → chọn tunnel đang chạy → Public Hostname → Add:
hostname `zb.thuongtd.cloud` → Service `http://localhost:3002`.

**Set webhook trỏ về hostname đó:**
```bash
WEBHOOK_URL=https://zb.thuongtd.cloud/webhook npm run set-webhook
```

**CI/CD tự động:** mỗi lần push lên nhánh `master`, GitHub Actions
(`.github/workflows/deploy.yml`) build image, push lên GHCR, rồi SSH vào
server (qua `cloudflared access ssh`, cùng cơ chế với `ssh.thuongtd.cloud`)
để `scp docker-compose.yml` + chạy `deploy.sh` (`docker compose pull && up -d`).
File `.env` trên server **không** bị ghi đè — chỉnh sửa trực tiếp trên server khi cần.

## Env vars

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `BOT_TOKEN` | Có | Từ Zalo Bot Manager |
| `WEBHOOK_SECRET` | Có | 8–256 ký tự, dùng `openssl rand -hex 32` |
| `SAVE_DIR` | Có | Thư mục lưu ảnh; production set `/data/images` (đã hardcode trong Dockerfile/compose) |
| `PORT` | Không | Default `3000` |
| `WEBHOOK_URL` | Không | Chỉ dùng cho `npm run set-webhook` |

## Scripts

| Lệnh | Mục đích |
|---|---|
| `npm run dev` | Chạy dev với hot-reload (`tsx watch`) |
| `npm run build` | Biên dịch TypeScript sang `build/` |
| `npm start` | Chạy bản đã build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Chạy Vitest |
| `npm run test:coverage` | Chạy Vitest kèm coverage report |
| `npm run set-webhook` | CLI set/xem/xoá webhook |

## Testing

```bash
npm test              # vitest run
npm run test:coverage # coverage >= 80% cho src/ (trừ server.ts, scripts/)
```

Không gọi API Zalo thật, không network thật trong unit test — `fetch` và bot object đều được mock ở boundary.

## Known limitations

- **`photoUrl` có thể hết hạn**: chưa xác định chính xác thời gian hết hạn từ Zalo — bot tải ảnh ngay lập tức trong listener (không queue) để giảm rủi ro. Cần theo dõi log 403/404 để ghi nhận thêm qua thời gian sử dụng thực tế.
- **Rate limit không công bố chính thức**: retry helper dùng backoff nhẹ (3 lần, base 500ms, cap 5s) như phỏng đoán an toàn, không dựa trên số liệu chính thức của Zalo.
- **Giới hạn 10MB cho ảnh**: không phải spec chính thức của Zalo (Zalo không công bố) — lấy theo default của dự án cộng đồng `zalobot-sdk` làm điểm tham chiếu gần nhất.
- **Không dedup webhook trùng**: nếu Zalo gửi lại cùng một `messageId` (do timeout/retry phía Zalo), bot sẽ tải và lưu lại — chưa có in-memory dedup theo `messageId` (YAGNI ở giai đoạn hiện tại, response 200 ngay giúp giảm khả năng này).
- **Reply gộp theo chat, không flush khi shutdown**: nếu server tắt đúng lúc một batch đang trong 2 giây debounce, tin nhắn xác nhận cuối có thể bị mất — nhưng ảnh vẫn đã lưu an toàn trên đĩa trước đó, chỉ mất phần phản hồi.
- **Không lọc theo loại chat**: bot lưu ảnh từ mọi loại chat gửi tới (private lẫn group), không giới hạn riêng cho nhóm.
- **Body chính xác của verification request lúc `setWebhook`**: chưa quan sát/ghi nhận được trong quá trình implement (cần log tạm thời lúc chạy E2E thực tế qua ngrok để xác nhận, sau đó xoá log debug).
