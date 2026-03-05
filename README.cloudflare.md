# Cloudflare Workers / Pages（Fork 增强版）部署说明

本项目提供 Cloudflare Workers / Pages（TypeScript，D1 + KV）版本，适合在 Cloudflare 上运行与代理出站。

## 一、前置条件

1. Cloudflare 账号。
2. 在 GitHub 仓库 Secrets 中配置：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

> 参考 `grok2api` 的做法，CI 会自动“查找或创建”D1/KV，并生成 `worker/wrangler.ci.toml`，你不需要再手动把 D1/KV ID 填到仓库文件里。

## 二、配置 `wrangler.toml`

`worker/wrangler.toml` 作为模板，保留占位符：

- `database_id = "REPLACE_WITH_D1_DATABASE_ID"`
- `id = "REPLACE_WITH_KV_NAMESPACE_ID"`

CI 部署时会自动替换成真实资源 ID。

并设置 Worker 运行时密钥：

```bash
cd worker
npx wrangler secret put JWT_SECRET
```

## 三、GitHub 上怎么配置（对应 Actions 页面）

进入：`GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> New repository secret`

添加：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Cloudflare API Token 推荐权限

- `Account:Cloudflare Workers Scripts:Edit`
- `Account:D1:Edit`
- `Account:Workers KV Storage:Edit`

### 获取 `CLOUDFLARE_ACCOUNT_ID`

Cloudflare Dashboard 右侧栏可看到 `Account ID`。

## 四、本地开发

```bash
npm install
npm run -w worker dev
npm run -w frontend dev
```

默认前端访问 `http://127.0.0.1:8787`。

## 五、GitHub Actions 一键部署

仓库内置工作流：

- `.github/workflows/cloudflare-workers.yml`

触发条件：

- push 到 `main`
- 手动 `workflow_dispatch`

工作流会：

1. 检查 Cloudflare Secrets
2. 安装依赖 + Worker 类型检查
3. 自动查找或创建 D1/KV
4. 生成 `worker/wrangler.ci.toml`
5. 自动执行 D1 migrations
6. `wrangler deploy`

## 六、常见失败排查

1. **Setup Node 报 lock file 错误**：不要启用 `setup-node` 的 `cache: npm`（本仓库已关闭）。
2. **`KV namespace ... is not valid`**：代表还在使用占位符，确认是否走了 `Generate wrangler.ci.toml` 步骤。
3. **`Authentication error`**：Token 权限不足或 Account ID 错误。
4. **`JWT_SECRET` 缺失**：在 Worker 环境执行 `wrangler secret put JWT_SECRET`。
5. **`code: 10097`（Free plan Durable Objects）**：`wrangler.toml` 里 DO 迁移必须使用 `new_sqlite_classes`，不能用 `new_classes`。本仓库已改为 SQLite DO 迁移声明。
