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

## 三、GitHub 上怎么配置（对应你截图的 Actions 页面）

### 1) 配置仓库 Secrets

进入：`GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> New repository secret`

依次添加：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

> 如果缺少这两个值，工作流会在 `Validate required Cloudflare secrets` 步骤直接失败并提示缺哪个。

### 2) Cloudflare API Token 推荐权限

创建 API Token 时至少给：

- `Account:Cloudflare Workers Scripts:Edit`
- `Account:D1:Edit`
- `Account:Workers KV Storage:Edit`

资源范围建议限定为你的目标账号，避免全局权限过大。

### 3) 获取 `CLOUDFLARE_ACCOUNT_ID`

Cloudflare Dashboard 右侧栏可看到 `Account ID`，复制后保存为 GitHub Secret。

### 4) 首次部署前执行 D1 迁移

```bash
cd worker
npx wrangler d1 migrations apply lot-db --remote
```

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

1. 检查 Cloudflare Secrets 是否存在
2. 安装 Node 依赖
3. 执行 Worker 类型检查
4. 执行 `wrangler deploy`

## 六、常见失败排查

1. **10 秒内快速失败**：大概率是 Secrets 未配置或名字写错。
2. **`Authentication error`**：Token 权限不够或账号 ID 错误。
3. **`database_id` / `kv id` 相关错误**：`wrangler.toml` 中占位符未替换。
4. **运行时报 `JWT_SECRET` 缺失**：需要在 Worker 环境中设置 secret，而不是只放在 GitHub Secrets。
