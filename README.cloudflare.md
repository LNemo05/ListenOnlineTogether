# Cloudflare Workers / Pages（Fork 增强版）部署说明

本项目提供 Cloudflare Workers / Pages（TypeScript，D1 + KV）版本，适合在 Cloudflare 上运行与代理出站。

## 一、前置条件

1. Cloudflare 账号。
2. 在 GitHub 仓库 Secrets 中配置：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. 具备以下资源（可通过 Wrangler 创建）：
   - D1 数据库（`lot-db`）
   - KV Namespace（房间元数据）

## 二、配置 `wrangler.toml`

请替换以下占位符：

- `database_id = "replace-with-real-id"`
- `kv_namespaces.id = "replace-with-real-kv-id"`

并设置密钥：

```bash
cd worker
npx wrangler secret put JWT_SECRET
```

## 三、本地开发

```bash
npm install
npm run -w worker dev
npm run -w frontend dev
```

默认前端访问 `http://127.0.0.1:8787`。

## 四、GitHub Actions 一键部署

仓库内置工作流：

- `.github/workflows/cloudflare-workers.yml`

触发条件：

- push 到 `main`
- 手动 `workflow_dispatch`

工作流会：

1. 安装 Node 依赖
2. 执行 Worker 类型检查
3. 执行 `wrangler deploy`

> 注意：发布前请确保 D1 migration 已执行，且 `JWT_SECRET` 已在 Cloudflare Worker 环境配置。
