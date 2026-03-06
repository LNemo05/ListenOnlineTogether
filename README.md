# ListenOnlineTogether

基于 Cloudflare 全家桶的轻量级音乐 Web 应用示例，实现了：

- 用户名+密码注册登录（无邮箱/手机号绑定）
- 音乐搜索、在线播放、歌单管理
- 后端代理音乐接口，规避前端 CORS
- D1 持久化用户与歌单数据
- Durable Object 房间级 WebSocket 状态同步（全员可控）
- 移动端优先的响应式界面

## 项目结构

- `frontend/`: React + Vite + Zustand 前端
- `worker/`: Cloudflare Workers + Hono API + Durable Object
- `worker/migrations/0001_init.sql`: D1 表结构

## 快速开始

```bash
npm install
npm run -w frontend dev
npm run -w worker dev
```

默认前端请求 `http://127.0.0.1:8787`，可通过 `VITE_API_BASE` 覆盖。

## 核心机制说明

### 1) 账号与鉴权

- 注册/登录仅需要用户名和密码
- Worker 通过 WebCrypto SHA-256 + 盐进行哈希
- 登录成功签发 JWT，前端存于 `localStorage`
- 前端注册区提供“忘记密码不可找回”醒目提示

### 2) 音乐代理

`GET /api/music/search`、`GET /api/music/url/:id`、`GET /api/music/pic/:id`、`GET /api/music/lyric/:id` 均由 Worker 按 GD 音乐 API 文档代理到 `music-api.gdstudio.xyz/api.php`，并透传 `source/br/count/pages/size` 等参数。

- `source` 支持文档中的音乐源（含 `bilibili`）以及高级写法 `*_album`（如 `netease_album`）。
- 搜索接口支持 `q` 与 `name` 两种关键词参数（内部统一映射到文档 `name`）。

### 3) 同步播放

- 客户端连接 `GET /api/rooms/:code/ws`
- 任意成员发出 `control` 指令（play/pause/seek/next）
- Durable Object 更新房间状态并广播给除发送者外所有连接
- 前端对 seek 采用 120ms 防抖

## WebSocket 消息

上行（客户端 -> 服务端）

```json
{
  "type": "control",
  "action": "seek",
  "songId": "12345",
  "playbackMs": 45000,
  "sentAt": 1723555555555
}
```

下行（服务端 -> 客户端）

```json
{
  "type": "sync",
  "action": "pause",
  "songId": "12345",
  "playbackMs": 46000,
  "online": 2
}
```

## Cloudflare 部署

- 部署与配置说明：`README.cloudflare.md`
- 一键部署工作流：`.github/workflows/cloudflare-workers.yml`
- 一键部署前置条件：仓库需配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。


## GD 音乐 API 使用说明（摘要）

- 仅用于学习用途，请勿下载/传播/商用。
- 建议稳定源：`netease`、`kuwo`、`joox`、`bilibili`。
- 访问限制：5 分钟不超过 50 次请求。
- 本项目前端支持选择 `source`（音源）和 `br`（音质）。


## 访问说明

- 访问 Worker 根域名将直接返回前端播放器页面（由 Worker `assets` 托管 `frontend/dist`）。
- API 仍通过 `/api/*` 提供。


## 项目定位说明

- 本项目是“前端播放器应用”，不是单独的 API 产品。
- Cloudflare Worker 在这里主要承担：
  - 音乐平台 API 代理（解决跨域 + 参数归一化）
  - 鉴权、歌单 CRUD、房间同步（DO）
- 访问 `workers.dev` 根域名应直接进入前端播放器页面；`/api/*` 只是前端依赖的后端接口。
