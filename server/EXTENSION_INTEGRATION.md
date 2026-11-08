# EasyRead Chrome 扩展同步功能集成指南

## 概述

将 EasyRead 扩展与云端同步后端集成，实现多设备数据同步。

## 集成步骤

### 1. 在扩展中添加配置

在 `src/scripts/easyReadData.mjs` 中添加同步配置：

```javascript
// 同步配置
export const SYNC_CONFIG_NAME = "syncConfig";
export const SYNC_ENABLED_NAME = "syncEnabled";

// 默认同步配置
export const DEFAULT_SYNC_CONFIG = {
  apiEndpoint: "", // 用户填写的 API 地址
  token: "", // 登录后的 JWT token
  userId: "", // 用户 ID
  lastSyncTime: 0,
  autoSync: true, // 是否自动同步
  syncInterval: 15 * 60 * 1000 // 15 分钟
};
```

### 2. 创建同步模块

创建 `src/scripts/syncEngine.js`：

```javascript
import * as easyReadTools from './easyReadTools.js';
import {
  ALL_RECORDS_NAME,
  READ_LATERS_NAME,
  NOTES_NAME,
  SYNC_CONFIG_NAME,
  SYNC_ENABLED_NAME
} from './easyReadData.mjs';

class SyncEngine {
  constructor() {
    this.syncing = false;
    this.config = null;
  }

  async init() {
    const stored = await chrome.storage.local.get([SYNC_CONFIG_NAME, SYNC_ENABLED_NAME]);
    this.config = stored[SYNC_CONFIG_NAME] || {};
    this.enabled = stored[SYNC_ENABLED_NAME] || false;

    if (this.enabled && this.config.autoSync) {
      this.startAutoSync();
    }
  }

  async updateConfig(config) {
    this.config = { ...this.config, ...config };
    await chrome.storage.local.set({ [SYNC_CONFIG_NAME]: this.config });
  }

  async login(email, password) {
    try {
      const response = await fetch(`${this.config.apiEndpoint}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      
      if (data.token) {
        await this.updateConfig({
          token: data.token,
          userId: data.user_id
        });
        return { success: true };
      }
      
      return { success: false, error: data.message };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async syncToCloud() {
    if (this.syncing || !this.config.token) return;

    this.syncing = true;
    
    try {
      // 获取本地数据
      const localData = await chrome.storage.local.get([
        READ_LATERS_NAME,
        ALL_RECORDS_NAME,
        NOTES_NAME
      ]);

      // 全量同步到云端
      const response = await fetch(`${this.config.apiEndpoint}/api/sync/full`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.token}`
        },
        body: JSON.stringify({
          readLaters: localData[READ_LATERS_NAME] || [],
          allRecords: localData[ALL_RECORDS_NAME] || {},
          notes: localData[NOTES_NAME] || {}
        })
      });

      const result = await response.json();
      
      if (result.synced) {
        await this.updateConfig({ lastSyncTime: Date.now() });
        console.log('Sync to cloud success:', result);
      }
    } catch (error) {
      console.error('Sync to cloud failed:', error);
    } finally {
      this.syncing = false;
    }
  }

  async syncFromCloud() {
    if (!this.config.token) return;

    try {
      const response = await fetch(
        `${this.config.apiEndpoint}/api/sync/pull?since=${this.config.lastSyncTime || 0}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.token}`
          }
        }
      );

      const data = await response.json();

      // 合并云端数据到本地
      if (data.readLaters || data.allRecords || data.notes) {
        const localData = await chrome.storage.local.get([
          READ_LATERS_NAME,
          ALL_RECORDS_NAME,
          NOTES_NAME
        ]);

        // 简单合并策略（云端优先）
        const merged = {
          [READ_LATERS_NAME]: [...(localData[READ_LATERS_NAME] || []), ...(data.readLaters || [])],
          [ALL_RECORDS_NAME]: { ...(localData[ALL_RECORDS_NAME] || {}), ...(data.allRecords || {}) },
          [NOTES_NAME]: { ...(localData[NOTES_NAME] || {}), ...(data.notes || {}) }
        };

        await chrome.storage.local.set(merged);
        await this.updateConfig({ lastSyncTime: data.syncedAt });
        
        console.log('Sync from cloud success');
      }
    } catch (error) {
      console.error('Sync from cloud failed:', error);
    }
  }

  startAutoSync() {
    setInterval(() => {
      if (this.enabled && this.config.token) {
        this.syncToCloud();
      }
    }, this.config.syncInterval || 15 * 60 * 1000);
  }
}

export const syncEngine = new SyncEngine();
```

### 3. 在 background.js 中初始化同步

在 `src/scripts/background.js` 中添加：

```javascript
import { syncEngine } from './syncEngine.js';

// 初始化同步引擎
chrome.runtime.onStartup.addListener(() => {
  syncEngine.init().catch(console.error);
});

chrome.runtime.onInstalled.addListener(() => {
  syncEngine.init().catch(console.error);
});

// 监听存储变化，触发同步
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && syncEngine.enabled) {
    // 防抖：500ms 后同步
    clearTimeout(syncEngine.syncTimer);
    syncEngine.syncTimer = setTimeout(() => {
      syncEngine.syncToCloud().catch(console.error);
    }, 500);
  }
});
```

### 4. 在设置页面添加同步配置 UI

在 `src/setting/setting.html` 中添加同步设置面板：

```html
<section id="syncPanel" class="settingsPanel" role="tabpanel" aria-labelledby="setting_tab_sync" hidden>
  <h2>Cloud Sync Settings</h2>
  
  <div class="settingBlock">
    <div class="settingToggleBlock">
      <div>
        <strong>Enable Cloud Sync</strong>
        <p>Sync your data across devices</p>
      </div>
      <label class="modernSwitch">
        <input type="checkbox" id="syncEnabled" />
        <span aria-hidden="true"></span>
      </label>
    </div>
  </div>

  <div class="settingBlock" id="syncConfigBlock" hidden>
    <label for="syncApiEndpoint">API Endpoint</label>
    <input type="text" id="syncApiEndpoint" placeholder="https://your-worker.workers.dev" />
    
    <h3 style="margin-top: 20px;">Account</h3>
    
    <div id="syncLoginForm">
      <label for="syncEmail">Email</label>
      <input type="email" id="syncEmail" placeholder="your@email.com" />
      
      <label for="syncPassword">Password</label>
      <input type="password" id="syncPassword" />
      
      <button type="button" id="btnSyncLogin" class="primaryButton">Login</button>
      <button type="button" id="btnSyncRegister" class="secondaryButton">Register</button>
    </div>

    <div id="syncStatus" hidden>
      <p>Logged in as: <span id="syncUserId"></span></p>
      <p>Last synced: <span id="lastSyncTime">Never</span></p>
      <button type="button" id="btnSyncNow" class="primaryButton">Sync Now</button>
      <button type="button" id="btnSyncLogout" class="secondaryButton">Logout</button>
    </div>
  </div>
</section>
```

在 `src/setting/setting.js` 中添加对应的处理逻辑。

### 5. 测试同步功能

1. 在扩展设置中启用同步
2. 输入 Cloudflare Workers 的 API 地址
3. 注册/登录账号
4. 点击"立即同步"测试

## 注意事项

- 首次同步建议使用全量同步
- 冲突解决策略：云端优先（可根据需求调整）
- 敏感数据加密存储（建议后续实现）
- 同步频率建议 15 分钟一次，避免频繁请求

## 下一步

- 实现增量同步优化
- 添加冲突解决 UI
- 支持手动选择同步项
- 添加同步日志查看
