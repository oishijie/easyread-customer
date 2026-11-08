#!/bin/bash
# EasyRead Sync 一键部署（交互式，适用于本机已 wrangler login 的场景）
# 无浏览器环境请用 deploy-cf.sh（API Token 方式）
set -e

echo "🚀 EasyRead Sync 部署"
echo "====================="
echo ""

if ! command -v wrangler > /dev/null; then
    echo "安装 Wrangler..."
    npm install -g wrangler
fi

if ! wrangler whoami > /dev/null 2>&1; then
    echo "请先登录 Cloudflare："
    wrangler login
fi

echo "1️⃣ 创建 D1 数据库..."
DB_OUTPUT=$(wrangler d1 create easyread-sync 2>&1 || true)

if echo "$DB_OUTPUT" | grep -q "database_id"; then
    DB_ID=$(echo "$DB_OUTPUT" | grep "database_id" | sed 's/.*database_id = "\(.*\)".*/\1/')
    sed -i.bak "s/database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml
    echo "✅ 数据库已创建: $DB_ID"
else
    echo "⚠️  数据库可能已存在，继续（若 database_id 仍为空请手动填写）"
fi

echo ""
echo "2️⃣ 初始化数据库表..."
wrangler d1 execute easyread-sync --remote --file=./schema.sql
echo "✅ 表已创建"

echo ""
echo "3️⃣ 设置 JWT_SECRET..."
if wrangler secret list 2>/dev/null | grep -q "JWT_SECRET"; then
    echo "✅ 已存在"
else
    openssl rand -base64 32 | wrangler secret put JWT_SECRET
    echo "✅ 已生成并写入"
fi

echo ""
echo "4️⃣ 部署..."
wrangler deploy

echo ""
echo "🎉 完成。打开 wrangler 输出的网址即是 Web Dashboard。"
echo ""
echo "可选：页面快照需要 R2。在 Cloudflare 后台开通 R2 后："
echo "  wrangler r2 bucket create easyread-snapshots"
echo "  然后取消 wrangler.toml 中 [[r2_buckets]] 的注释并重新部署"
