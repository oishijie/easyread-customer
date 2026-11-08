# 部署指南

## 步骤 1：安装 Wrangler CLI

```bash
npm install -g wrangler
```

或使用项目本地的：
```bash
npm install
```

## 步骤 2：登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开授权页面，完成登录。

## 步骤 3：创建 D1 数据库

```bash
npx wrangler d1 create easyread-sync
```

输出示例：
```
✅ Successfully created DB 'easyread-sync'

[[d1_databases]]
binding = "DB"
database_name = "easyread-sync"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**重要**：复制 `database_id`，粘贴到 `wrangler.toml` 文件中：

```toml
[[d1_databases]]
binding = "DB"
database_name = "easyread-sync"
database_id = "粘贴你的 database_id"
```

## 步骤 4：初始化数据库表

```bash
npx wrangler d1 execute easyread-sync --file=./schema.sql
```

## 步骤 5：（可选）创建 R2 存储桶

只有页面快照功能需要 R2，且 R2 必须在 Cloudflare 后台单独开通（免费额度也要绑支付方式）。
未开通时直接跳过，`wrangler.toml` 默认不绑定 R2，核心同步功能不受影响。

开通后执行：

```bash
npx wrangler r2 bucket create easyread-snapshots
```

再取消 `wrangler.toml` 中 `[[r2_buckets]]` 整段的注释，重新部署。

## 步骤 6：设置 JWT 密钥

密钥不要写进 `wrangler.toml`，用 Worker Secret 保存：

```bash
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET
```

本地开发时用 `.dev.vars` 文件（已在 `.gitignore` 中）：

```
JWT_SECRET="dev-secret-key-change-in-production"
```

## 步骤 7：部署到 Cloudflare

```bash
npx wrangler deploy
```

成功后会显示你的 Worker URL：
```
Published easyread-sync (0.01 sec)
  https://easyread-sync.your-subdomain.workers.dev
```

## 步骤 8：测试 API

```bash
# 健康检查
curl https://easyread-sync.your-subdomain.workers.dev/health

# 注册用户
curl -X POST https://easyread-sync.your-subdomain.workers.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# 登录
curl -X POST https://easyread-sync.your-subdomain.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## 本地开发

```bash
# 本地初始化数据库
npx wrangler d1 execute easyread-sync --local --file=./schema.sql

# 启动开发服务器
npm run dev
```

访问 `http://localhost:8787`

## 故障排查

### 问题：部署失败 "Missing binding DB"

解决：确保 `wrangler.toml` 中的 `database_id` 已填写。

### 问题：CORS 错误

解决：检查 `wrangler.toml` 中的 `CORS_ORIGIN` 设置，开发时可以设为 `*`。

### 问题：JWT 认证失败

解决：确认已通过 `wrangler secret put JWT_SECRET` 设置密钥，本地开发检查 `.dev.vars` 是否存在。

## 生产环境建议

1. **设置自定义域名**：在 Cloudflare Dashboard 中绑定自定义域名
2. **启用 Rate Limiting**：防止 API 滥用
3. **配置 WAF 规则**：保护 API 端点
4. **定期备份 D1 数据库**：导出数据库快照
5. **监控使用情况**：在 Cloudflare Dashboard 查看请求量和错误率

## 自定义域名配置

1. 进入 Cloudflare Dashboard
2. 选择你的 Worker：`easyread-sync`
3. 点击 "Triggers" 标签
4. 添加 "Custom Domain"
5. 输入域名，如 `api.yourdomain.com`

## 下一步

- 在 EasyRead 扩展中配置同步功能
- 查看 `EXTENSION_INTEGRATION.md` 了解如何集成
