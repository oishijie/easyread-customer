# EasyRead Sync API 设计

## 认证

所有 API 需要 Bearer Token 认证：
```
Authorization: Bearer <user_token>
```

## API 端点

### 1. 用户认证

#### POST /api/auth/register
注册新用户
```json
Request:
{
  "email": "user@example.com",
  "password": "password"
}

Response:
{
  "token": "jwt_token",
  "user_id": "uuid"
}
```

#### POST /api/auth/login
用户登录
```json
Request:
{
  "email": "user@example.com", 
  "password": "password"
}

Response:
{
  "token": "jwt_token",
  "user_id": "uuid"
}
```

### 2. 稍后阅读

#### GET /api/read-later
获取稍后阅读列表
```json
Query: ?status=0&limit=50&offset=0

Response:
{
  "items": [
    {
      "id": "uuid",
      "key": "http://example.com/",
      "url": "http://example.com/#page",
      "title": "Example Page",
      "createDateTime": 1679496233321,
      "status": 0,
      "position": {
        "progress": 70.68,
        "scrollX": 0,
        "scrollY": 13040
      }
    }
  ],
  "total": 150
}
```

#### POST /api/read-later
添加稍后阅读
```json
Request:
{
  "key": "http://example.com/",
  "url": "http://example.com/#page",
  "title": "Example Page"
}

Response:
{
  "id": "uuid",
  "created": true
}
```

#### PUT /api/read-later/:id
更新阅读状态/进度
```json
Request:
{
  "status": 1,
  "position": {
    "progress": 50.5,
    "scrollX": 0,
    "scrollY": 8000
  }
}

Response:
{
  "updated": true
}
```

#### DELETE /api/read-later/:id
删除稍后阅读项

### 3. 笔记

#### GET /api/notes
获取所有笔记页面
```json
Query: ?limit=50&offset=0

Response:
{
  "pages": [
    {
      "url": "http://example.com/",
      "title": "Example",
      "createDateTime": 1679497233321,
      "notesCount": 5
    }
  ],
  "total": 30
}
```

#### GET /api/notes/:url
获取指定页面的笔记（url 需要 URL encode）
```json
Response:
{
  "url": "http://example.com/",
  "title": "Example",
  "notes": [
    {
      "id": "uuid",
      "scope": "text",
      "selectionText": "highlighted text",
      "comment": "my comment",
      "author": "John",
      "createDateTime": 1679496233321,
      "textPosition": 100
    }
  ]
}
```

#### POST /api/notes
添加笔记
```json
Request:
{
  "url": "http://example.com/",
  "title": "Example",
  "note": {
    "scope": "text",
    "selectionText": "highlighted text",
    "comment": "my comment",
    "prefix": "context before",
    "suffix": "context after",
    "textPosition": 100
  }
}

Response:
{
  "id": "uuid",
  "created": true
}
```

#### DELETE /api/notes/:noteId
删除笔记

### 4. 访问记录

#### GET /api/records
获取访问记录
```json
Query: ?limit=100&offset=0

Response:
{
  "records": [
    {
      "url": "http://example.com/",
      "title": "Example",
      "datetime": [1679496233321, 1679596233321],
      "visitCount": 2
    }
  ],
  "total": 500
}
```

#### POST /api/records/sync
批量同步访问记录
```json
Request:
{
  "records": {
    "http://example.com/": {
      "url": "http://example.com/",
      "title": "Example",
      "datetime": [1679496233321]
    }
  }
}

Response:
{
  "synced": 1
}
```

### 5. 链接收藏

收藏与稍后阅读相互独立，按规范化页面 URL（`key`）幂等去重：同一个 `key` 重复提交只更新现有行。

#### GET /api/favorites
获取收藏列表
```json
Query: ?limit=50&offset=0   # limit 上限 200

Response:
{
  "items": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "key": "https://example.com/",
      "url": "https://example.com/article",
      "title": "Example",
      "create_datetime": 1679496233321,
      "synced_at": 1679496233321
    }
  ],
  "total": 1
}
```

#### POST /api/favorites
添加或更新收藏
```json
Request:
{
  "key": "https://example.com/",
  "url": "https://example.com/article",
  "title": "Example",
  "createDateTime": 1679496233321
}

Response:
{
  "id": "uuid",
  "created": true
}
```

#### DELETE /api/favorites/:id
删除收藏，同时在 `tombstones` 留下 `entity='favorite'` 的墓碑，其它设备拉取时不会把已删条目加回来。
```json
Response:
{
  "deleted": true
}
```

### 6. 页面快照

#### POST /api/snapshots/upload
上传页面快照到 R2
```
Content-Type: multipart/form-data

Fields:
- file: binary data
- url: string
- title: string
- format: 'html' | 'pdf' | 'markdown' | 'screenshot'

Response:
{
  "id": "uuid",
  "r2_url": "https://r2.../snapshot.html"
}
```

#### GET /api/snapshots
获取快照列表
```json
Query: ?url=http://example.com/&limit=20

Response:
{
  "snapshots": [
    {
      "id": "uuid",
      "url": "http://example.com/",
      "title": "Example",
      "format": "html",
      "fileSize": 102400,
      "createdAt": 1679496233321,
      "downloadUrl": "https://r2.../snapshot.html"
    }
  ]
}
```

#### GET /api/snapshots/:id/download
按 id 下载快照文件，返回文件字节流（`Content-Disposition` 带原始文件名，`Content-Type` 取记录的 mime）。

#### DELETE /api/snapshots/:id
删除快照记录并同步删除 R2 对象（未配 R2 时只删元数据）。
```json
Response:
{
  "deleted": true
}
```

### 7. 同步

#### POST /api/sync/full
全量同步（上传本地所有数据）
```json
Request:
{
  "readLaters": [...],
  "allRecords": {...},
  "notes": {...},
  "favorites": [...],
  "favoriteDeletions": ["https://example.com/"]
}

Response:
{
  "synced": true,
  "syncedAt": 1679496233321,
  "syncedCount": 12
}
```

`favoriteDeletions` 是本地删除的收藏 `key` 队列：服务端先按 key 删行并落墓碑，再写入 `favorites`，因此同一次推送中「删了又收」以写入为准。

#### GET /api/sync/pull
拉取云端数据
```json
Query: ?since=1679496233321

Response:
{
  "readLaters": [...],
  "allRecords": {...},
  "notes": {...},
  "favorites": [...],
  "deletedIds": {
    "readLaters": ["id1", "id2"],
    "notes": ["id3"],
    "favorites": ["https://example.com/"]
  },
  "syncedAt": 1679496233321
}
```

## 错误响应

```json
{
  "error": "error_code",
  "message": "Human readable message"
}
```

常见错误码：
- `UNAUTHORIZED`: 未认证或 token 无效
- `FORBIDDEN`: 无权访问
- `NOT_FOUND`: 资源不存在
- `CONFLICT`: 数据冲突
- `INVALID_REQUEST`: 请求参数错误
