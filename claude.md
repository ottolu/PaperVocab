# PaperVocab — Claude Code 项目备忘录

## 项目概述

学术论文划词生词本 Chrome 插件 (MV3)，原生 HTML/CSS/JS，零构建零依赖。
PRD 文件：`PaperVocab-PRD.md`（v0.3 Final Draft）

## 架构决策

### 文件结构与模块关系

```
papervocab/
├── manifest.json                 # MV3 清单
├── background/service-worker.js  # 后台（自包含，内联了 lib 代码）
├── content/content.js            # 内容脚本（自包含，工具函数本地复制）
├── content/content.css            # 仅一行注释，样式全部在 JS 中注入 Shadow DOM
├── popup/popup.{html,css,js}     # 弹出页（生词本 + 复习）
├── options/options.{html,css,js} # 设置页
├── lib/{utils,storage,llm}.js    # 共享库源码（仅作参考，不在运行时被加载）
└── icons/icon{16,32,48,128}.png  # 蓝底白字 "PV" 图标
```

### 关键架构约束

1. **Service Worker 必须自包含** — MV3 的 service worker 不支持 `importScripts()` 加载扩展本地文件。`lib/` 下的代码已全部内联到 `service-worker.js` 中。如果修改 `lib/` 中的逻辑，**必须同步更新 `service-worker.js` 中对应的内联副本**。

2. **Content Script 必须自包含** — content script 无法使用 `importScripts()`，也不是 ES module。工具函数（`isEnglishWordLocal`、`extractSentenceLocal`、`escapeHtmlLocal`）在 `content.js` 底部以 `*Local` 后缀本地定义。修改 `lib/utils.js` 时需**同步更新这三处副本**。

3. **三个独立运行时之间通过 chrome.runtime.sendMessage 通信**：
   - Content Script ↔ Service Worker：`QUERY_WORD`、`SAVE_WORD`、`OPEN_OPTIONS`
   - Popup/Options → Storage：直接调用 `chrome.storage.local/sync`（不经过 SW）
   - Content Script → Service Worker：`GET_SETTINGS`（启动时加载一次）

### 存储分工

| 存储 | 用途 | Key |
|------|------|-----|
| `chrome.storage.local` | 全部单词数据 | `"words"` → `WordEntry[]` |
| `chrome.storage.sync` | 用户设置（≤100KB） | `"settings"` → `UserSettings` |

## 踩过的坑（必读）

### 1. importScripts 在 MV3 Service Worker 中不可用
**问题**：`importScripts('../lib/utils.js', ...)` 直接报错导致 Service Worker 完全不启动，所有消息无法处理，划词零反应。
**解决**：将全部 lib 代码内联到 `service-worker.js`。lib/ 目录仅作为源码参考保留。
**教训**：MV3 service worker 与传统 background page 的模块加载机制完全不同。

### 2. Shadow DOM 宿主元素的 overflow 和挂载点
**问题**：宿主 `width:0; height:0` 没有配 `overflow:visible`，fixed 定位的子元素被裁剪不显示；挂在 `document.body` 上，某些页面 body 未就绪。
**解决**：宿主挂载到 `document.documentElement`，内联样式加 `overflow:visible;pointer-events:none`。

### 3. DOMRect 是活引用
**问题**：`range.getBoundingClientRect()` 返回的 DOMRect 是与选区绑定的活引用，选区变化后坐标归零，导致浮标/浮窗定位在 (0,0)。
**解决**：立刻解构为普通对象 `{ top, right, bottom, left, width, height }`。

### 4. content.css 与 Shadow DOM 样式的职责划分
**问题**：最初 `content.css` 中写了宿主样式（`#papervocab-root { ... }`），但它作用于主文档，被宿主页面 CSS 影响。
**解决**：`content.css` 保持为空（仅注释），所有样式由 `content.js` 通过 `getShadowStyles()` 注入到 Shadow DOM 内部。宿主自身样式用内联 `style.cssText` 设置。

### 5. mousedown 关闭与 mouseup 选词的竞争
**问题**：mousedown 立即关闭浮窗/浮标，但紧接着的 mouseup 尝试创建新浮标，出现闪烁或不响应。
**解决**：mousedown 关闭逻辑加 50ms 延迟，检查是否有新选区产生后再决定是否关闭。

## 数据模型

```typescript
interface WordEntry {
  id: string;              // UUID v4
  word: string;            // lemma（原形，由 LLM 返回）
  originalForm: string;    // 用户选中的原始形态
  phonetic: string;        // 国际音标
  definition: string;      // 中文释义
  example: string;         // 学术例句
  contexts: Context[];     // 每次查询追加
  queryCount: number;      // 查询次数
  masteryLevel: number;    // 0-3，≥3 为已掌握
  mastered: boolean;
  createdAt: string;       // ISO 8601
  updatedAt: string;
}

interface UserSettings {
  llmProvider: 'openai' | 'anthropic' | 'custom';
  apiKey: string;
  apiBaseUrl: string;
  modelName: string;
  triggerMode: 'icon' | 'auto' | 'hotkey';
  hotkey: string;
  reviewBatchSize: number; // 默认 20
}
```

## LLM 调用注意事项

- **Anthropic 浏览器调用**需要额外 header：`anthropic-dangerous-direct-browser-access: true`
- 超时 10s，自动重试 1 次（间隔 2s）
- JSON 解析三级容错：直接 parse → 正则提取 `{...}` → 整段文本当 definition
- 已收藏单词再次查询**不调用 LLM**，直接从本地读取 + 追加 context + queryCount++

## 配色方案

| 用途 | 颜色 |
|------|------|
| 主色 | `#2563EB` |
| 成功/认识 | `#10B981` |
| 警告/模糊 | `#F59E0B` |
| 危险/不认识 | `#EF4444` |
| 正文 | `#1F2937` |
| 辅助 | `#6B7280` |
| 边框 | `#E5E7EB` |

## 开发 & 调试提示

- 修改 service-worker.js 后需要在 `chrome://extensions` 点刷新，**然后关闭再重新打开 DevTools 的 Service Worker inspector**
- 修改 content.js 后需要**刷新目标网页**
- 修改 popup/options 文件后需要**重新打开 popup / options 页面**
- 所有 console.log 统一加 `[PaperVocab]` 前缀
- content.js 的 mouseup handler 有调试日志：`[PaperVocab] mouseup — selection info: xxx`

## 待做 / 已知限制

- PDF 支持：Chrome 内置 PDF Viewer 的 content script 注入需实际测试验证
- 虚拟滚动：生词本列表在词量极大时可考虑
- 快捷键触发模式（hotkey）：UI 已搭建但触发逻辑尚未实现
- lib/ 目录的文件仅作参考源码保留，运行时不被任何模块加载
