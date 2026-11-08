#!/bin/sh
# 非交互部署：适用于没有浏览器的环境（CI / 容器），用 API Token 认证
#
# 用法：
#   CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy ./deploy-cf.sh
#
# Token 权限需要：
#   Account → Workers Scripts:Edit
#   Account → D1:Edit
#   Account → Workers R2 Storage:Edit
#   Account → Account Settings:Read
set -e

: "${CLOUDFLARE_API_TOKEN:?需要 CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?需要 CLOUDFLARE_ACCOUNT_ID}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

DB_NAME="${DB_NAME:-easyread-sync}"
R2_BUCKET="${R2_BUCKET:-easyread-snapshots}"

cf_api() {
    printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN" | curl -s --config - "$@"
}

echo "1️⃣ 校验 token..."
VERIFY=$(cf_api https://api.cloudflare.com/client/v4/user/tokens/verify)
if ! echo "$VERIFY" | grep -q '"success":true'; then
    echo "✘ token 无效："
    echo "$VERIFY" | head -5
    exit 1
fi
echo "✓ token 有效"

echo ""
echo "2️⃣ 确认账号..."
ACC=$(cf_api "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID")
ACC_NAME=$(echo "$ACC" | grep -o '"name":"[^"]*"' | head -1 | sed 's/"name":"//;s/"//')
if ! echo "$ACC" | grep -q '"success":true'; then
    echo "✘ 账号 ID 无效或无权限："
    echo "$ACC" | head -5
    exit 1
fi
echo "✓ 账号: $ACC_NAME"

echo ""
echo "3️⃣ 创建 D1 数据库 $DB_NAME..."
CREATE=$(cf_api -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$DB_NAME\"}")
DB_ID=$(echo "$CREATE" | grep -o '"uuid":"[^"]*"' | head -1 | sed 's/"uuid":"//;s/"//')

if [ -z "$DB_ID" ]; then
    echo "• 创建未成功，查找已存在的同名数据库..."
    LIST=$(cf_api "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database")
    DB_ID=$(echo "$LIST" | tr '}' '\n' | grep "\"name\":\"$DB_NAME\"" | grep -o '"uuid":"[^"]*"' | head -1 | sed 's/"uuid":"//;s/"//')
fi

if [ -z "$DB_ID" ]; then
    echo "✘ 无法创建或找到 D1 数据库"
    echo "$CREATE" | head -5
    exit 1
fi
echo "✓ database_id = $DB_ID"

echo ""
echo "4️⃣ 写入 wrangler.toml..."
sed -i.bak "s/database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml
grep -n "database_id" wrangler.toml

echo ""
echo "5️⃣ 建表..."
npx wrangler d1 execute "$DB_NAME" --remote --yes --file=./schema.sql
echo "✓ 表已创建"

echo ""
echo "6️⃣ 创建 R2 存储桶 $R2_BUCKET..."
R2_OUT=$(cf_api -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$R2_BUCKET\"}")
if echo "$R2_OUT" | grep -q '"success":true'; then
    echo "✓ 已创建"
elif echo "$R2_OUT" | grep -qi 'already exists\|already owned'; then
    echo "• 已存在"
else
    echo "⚠️  R2 返回："
    echo "$R2_OUT" | head -3
fi

echo ""
echo "7️⃣ 部署 Worker..."
npx wrangler deploy

echo ""
echo "8️⃣ 写入 JWT_SECRET..."
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET
echo "✓ 已写入（立即生效，无需重新部署）"

echo ""
echo "🎉 部署完成"
