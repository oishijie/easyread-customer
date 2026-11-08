# 快速入门 - 5 分钟搭建 EasyRead 同步后端

## 前置条件

- Node.js 16+ 已安装
- Cloudflare 账号（免费版即可）

## 快速部署（推荐）

### 方式一：一键脚本

```bash
cd ~/workspace/easyread-sync
npm install
./deploy.sh
```

脚本会自动完成：
1. ✅ 创建 D1 数据库
2. ✅ 初始化表结构
3. ✅ 创建 R2 存储桶
4. ✅ 生成 JWT 密钥
5. ✅ 部署到 Cloudflare

### 方式二：手动部署

```bash
cd ~/workspace/easyread-sync
npm install

# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建数据库
npx wrangler d1 create easyread-sync
# 复制输出的 database_id 到 wrangler.toml

# 3. 初始化表
npx wrangler d1 execute easyread-sync --file=./schema.sql

# 4. 创建 R2 存储桶
npx wrangler r2 bucket create easyread-snapshots

# 5. 设置 JWT 密钥（Worker Secret，不写进仓库）
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET

# 6. 部署
npx wrangler deploy
```

## 测试部署

```bash
# 替换为你的 Worker URL
API_URL="https://easyread-sync.your-subdomain.workers.dev"

# 1. 健康检查
curl $API_URL/health

# 2. 注册用户
curl -X POST $API_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# 保存返回的 token
TOKEN="你的_token"

# 3. 添加稍后阅读
curl -X POST $API_URL/api/read-later \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "https://example.com/",
    "url": "https://example.com/article",
    "title": "Test Article"
  }'

# 4. 获取列表
curl $API_URL/api/read-later \
  -H "Authorization: Bearer $TOKEN"
```

## 集成到 EasyRead 扩展

1. 打开 EasyRead 扩展设置页面
2. 找到"同步设置"（或按照 EXTENSION_INTEGRATION.md 添加此功能）
3. 输入你的 API 地址：`https://easyread-sync.your-subdomain.workers.dev`
4. 登录账号
5. 点击"立即同步"

## 常见问题

### Q: 部署后无法访问？
A: 检查 Cloudflare Dashboard 中的 Worker 是否已部署成功，查看 Workers → easyread-sync → Logs

### Q: 数据库连接失败？
A: 确保 wrangler.toml 中的 database_id 正确填写

### Q: JWT 认证失败？
A: 确认已执行 `npx wrangler secret put JWT_SECRET`，本地开发检查 `.dev.vars` 是否存在

### Q: CORS 错误？
A: 开发环境设置 `CORS_ORIGIN = "*"`，生产环境改为具体域名

## 下一步

- 📖 查看 [完整 API 文档](./api-design.md)
- 🔧 参考 [扩展集成指南](./EXTENSION_INTEGRATION.md)
- 💡 阅读 [使用示例](./EXAMPLES.md)
- 🚀 了解 [部署细节](./DEPLOYMENT.md)

## 项目结构速览

```
easyread-sync/
├── src/
│   ├── index.ts           # 主入口
│   ├── routes/            # API 路由
│   │   ├── auth.ts        # 认证
│   │   ├── read-later.ts  # 稍后阅读
│   │   ├── notes.ts       # 笔记
│   │   ├── records.ts     # 访问记录
│   │   ├── snapshots.ts   # 快照
│   │   └── sync.ts        # 同步
│   ├── lib/               # 工具函数
│   ├── middleware/        # 中间件
│   └── types/             # 类型定义
├── schema.sql             # 数据库表结构
├── wrangler.toml          # CF 配置
├── deploy.sh              # 一键部署脚本
└── README.md              # 项目说明
```

## 费用说明

使用 Cloudflare 免费版：
- ✅ Workers: 100,000 请求/天
- ✅ D1: 5GB 存储
- ✅ R2: 10GB 存储

个人使用完全免费！

## 获取帮助

- 查看 [项目总结](./PROJECT_SUMMARY.md)
- 阅读 [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- 查看 [EasyRead 扩展](https://github.com/volnet/chrome-extensions-easyread)

开始同步你的阅读数据吧！🚀
