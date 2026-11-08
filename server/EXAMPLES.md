# EasyRead Sync API 使用示例

## 完整使用流程示例

### 1. 注册新用户

```bash
curl -X POST https://your-worker.workers.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "mypassword123"
  }'
```

响应：
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

保存 `token` 用于后续请求。

### 2. 添加稍后阅读

```bash
curl -X POST https://your-worker.workers.dev/api/read-later \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "https://example.com/",
    "url": "https://example.com/article",
    "title": "Interesting Article About AI"
  }'
```

### 3. 获取稍后阅读列表

```bash
curl https://your-worker.workers.dev/api/read-later?status=0&limit=10 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. 更新阅读进度

```bash
curl -X PUT https://your-worker.workers.dev/api/read-later/ITEM_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": 1,
    "position": {
      "progress": 50.5,
      "scrollX": 0,
      "scrollY": 5000
    }
  }'
```

### 5. 添加页面笔记

```bash
curl -X POST https://your-worker.workers.dev/api/notes \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "title": "Interesting Article",
    "note": {
      "scope": "text",
      "selectionText": "This is important text I highlighted",
      "comment": "Remember to review this later",
      "prefix": "context before",
      "suffix": "context after",
      "textPosition": 1500
    }
  }'
```

### 6. 获取页面笔记

```bash
# URL 需要进行 URL encode
URL_ENCODED="https%3A%2F%2Fexample.com%2Farticle"

curl "https://your-worker.workers.dev/api/notes/${URL_ENCODED}" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 7. 批量同步访问记录

```bash
curl -X POST https://your-worker.workers.dev/api/records/sync \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "records": {
      "https://example.com/": {
        "url": "https://example.com/",
        "title": "Example Site",
        "datetime": [1679496233321, 1679596233321]
      },
      "https://github.com/": {
        "url": "https://github.com/",
        "title": "GitHub",
        "datetime": [1679496233321]
      }
    }
  }'
```

### 8. 全量同步（从扩展上传所有数据）

```bash
curl -X POST https://your-worker.workers.dev/api/sync/full \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "readLaters": [
      {
        "key": "https://example.com/",
        "url": "https://example.com/article",
        "title": "Article 1",
        "create_datetime": 1679496233321,
        "status": 0
      }
    ],
    "allRecords": {
      "https://example.com/": {
        "url": "https://example.com/",
        "title": "Example",
        "datetime": [1679496233321]
      }
    },
    "notes": {
      "https://example.com/": {
        "url": "https://example.com/",
        "title": "Example",
        "notes": [
          {
            "id": "note-123",
            "scope": "text",
            "selectionText": "highlighted text",
            "comment": "my comment",
            "createDateTime": 1679496233321
          }
        ]
      }
    }
  }'
```

### 9. 增量同步（从云端拉取变更）

```bash
# 获取自上次同步以来的所有变更
curl "https://your-worker.workers.dev/api/sync/pull?since=1679496233321" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 10. 上传页面快照

```bash
curl -X POST https://your-worker.workers.dev/api/snapshots/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@page.html" \
  -F "url=https://example.com/" \
  -F "title=Example Page" \
  -F "format=html"
```

### 11. 下载快照

```bash
curl "https://your-worker.workers.dev/api/snapshots/SNAPSHOT_ID/download" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o downloaded-page.html
```

## JavaScript 客户端示例

```javascript
class EasyReadSyncClient {
  constructor(apiBase, token) {
    this.apiBase = apiBase;
    this.token = token;
  }

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.apiBase}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    return response.json();
  }

  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    this.token = data.token;
    return data;
  }

  async getReadLater(status, limit = 50) {
    return this.request(`/api/read-later?status=${status}&limit=${limit}`);
  }

  async addReadLater(item) {
    return this.request('/api/read-later', {
      method: 'POST',
      body: JSON.stringify(item)
    });
  }

  async syncToCloud(data) {
    return this.request('/api/sync/full', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async syncFromCloud(since = 0) {
    return this.request(`/api/sync/pull?since=${since}`);
  }
}

// 使用示例
const client = new EasyReadSyncClient('https://your-worker.workers.dev', null);

// 登录
await client.login('user@example.com', 'password123');

// 获取稍后阅读
const readLater = await client.getReadLater(0);
console.log(readLater);

// 同步到云端
await client.syncToCloud({
  readLaters: [...],
  allRecords: {...},
  notes: {...}
});
```

## Python 客户端示例

```python
import requests

class EasyReadSyncClient:
    def __init__(self, api_base, token=None):
        self.api_base = api_base
        self.token = token
    
    def request(self, endpoint, method='GET', data=None):
        headers = {
            'Content-Type': 'application/json'
        }
        
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        
        url = f'{self.api_base}{endpoint}'
        
        if method == 'GET':
            response = requests.get(url, headers=headers)
        elif method == 'POST':
            response = requests.post(url, json=data, headers=headers)
        elif method == 'PUT':
            response = requests.put(url, json=data, headers=headers)
        elif method == 'DELETE':
            response = requests.delete(url, headers=headers)
        
        response.raise_for_status()
        return response.json()
    
    def login(self, email, password):
        data = self.request('/api/auth/login', 'POST', {
            'email': email,
            'password': password
        })
        self.token = data['token']
        return data
    
    def get_read_later(self, status=None, limit=50):
        endpoint = f'/api/read-later?limit={limit}'
        if status is not None:
            endpoint += f'&status={status}'
        return self.request(endpoint)

# 使用示例
client = EasyReadSyncClient('https://your-worker.workers.dev')
client.login('user@example.com', 'password123')

read_later = client.get_read_later(status=0)
print(read_later)
```

## 错误处理

API 错误响应格式：
```json
{
  "error": "ERROR_CODE",
  "message": "Human readable error message"
}
```

常见错误码：
- `UNAUTHORIZED` (401) - Token 无效或缺失
- `FORBIDDEN` (403) - 无权访问
- `NOT_FOUND` (404) - 资源不存在
- `CONFLICT` (409) - 资源冲突（如邮箱已注册）
- `INVALID_REQUEST` (400) - 请求参数错误
- `SERVER_ERROR` (500) - 服务器内部错误

## 速率限制

Cloudflare Workers 免费额度：
- 100,000 请求/天
- 建议客户端实现请求队列和重试机制

## 最佳实践

1. **Token 存储**：安全存储 JWT token，不要暴露在代码中
2. **错误重试**：网络错误时实现指数退避重试
3. **批量操作**：尽量使用批量 API（如 `/sync/full`）减少请求次数
4. **增量同步**：使用 `since` 参数只拉取变更数据
5. **本地缓存**：缓存常用数据，减少 API 调用
