# PaperVocab — 学术论文划词生词本 Chrome 插件 PRD

> **Version:** 1.0.0 (Implementation Release)
> **Last Updated:** 2026-02-08
> **Author:** User + Claude

---

## 1. 产品概述

### 1.1 产品名称
**PaperVocab**

### 1.2 一句话描述
一款 Chrome 浏览器插件，帮助学术论文阅读者通过划词查询、LLM 智能释义、生词本管理和卡片复习，系统性地积累学术词汇。

### 1.3 要解决的问题
阅读英文学术论文时，经常遇到不认识的专业词汇或生僻单词。传统做法是临时查词典，但查完就忘，无法形成有效积累。用户需要一个**零摩擦**的工具：在阅读过程中快速查词并自动记录，事后可以系统复习，逐步掌握高频学术生词。

### 1.4 目标用户
- 经常阅读英文学术论文的研究生、博士生、科研工作者
- 英语非母语，希望提升学术英语词汇量
- 主要在 Chrome 浏览器中阅读在线论文（HTML 和 PDF）

### 1.5 核心价值主张
| 现有方案痛点 | PaperVocab 解决方式 |
|---|---|
| 查完词典就忘，无法积累 | 自动记录每次查询，构建个人生词本 |
| 通用词典释义不贴合学术语境 | LLM 生成学术语境下的精准中文释义 |
| 不知道哪些词是高频重要词 | 查询频次统计，高频词优先复习 |
| 没有复习机制 | 内置翻卡片复习功能 |
| 阅读 PDF 时无法划词查词 | 同时支持 HTML 页面和浏览器内 PDF |

---

## 2. 功能需求

### 2.1 功能架构总览

```
┌─────────────────────────────────────────────────┐
│                  PaperVocab                      │
├──────────┬──────────┬───────────┬────────────────┤
│  划词查询  │  生词本   │  卡片复习  │     设置       │
│ Content   │ Popup    │ Popup     │  Options Page  │
│ Script    │ Page     │ Page      │               │
├──────────┴──────────┴───────────┴────────────────┤
│            Service Worker (后台，自包含)            │
│     LLM API 调用 · 数据存储 · Chrome Storage      │
└─────────────────────────────────────────────────┘
```

> **实现说明**：Service Worker 将 lib/ 下所有代码内联，因为 MV3 不支持 `importScripts()` 加载扩展本地文件。Content Script 同样自包含工具函数。三个运行时之间通过 `chrome.runtime.sendMessage` 通信。

### 2.2 Feature 1: 划词查询

**触发方式：划词 + 点击图标（默认）/ 划词自动弹出**

#### 用户流程
1. 用户在网页中用鼠标选中一个英文单词（或最多 3 个单词的短语）
2. 选中后，单词旁边出现一个小的 PaperVocab 浮标图标（22×22px 蓝色圆形，内嵌 "PV" SVG）
3. 用户点击图标 → 弹出释义浮窗（tooltip）
4. 浮窗中显示：加载动画（spinner + "查询中..."）→ LLM 返回的释义内容
5. 用户可选择：
   - **收藏到生词本**（点击 ⭐ 按钮 → 变为「已收藏 ✓」绿色状态）
   - **关闭浮窗**（点击其他区域或按 Esc）
6. **重复查词处理（静默计数）**：如果单词已在生词本中：
   - **不调用 LLM**（节省 API 费用和响应时间）
   - 直接从本地读取已有释义展示
   - 浮窗顶部显示「已收藏 ×N」蓝色 badge
   - 自动 +1 查询次数
   - 自动追加本次 context（原文句子、来源论文、时间）
   - **不覆盖**已有释义（保留首次 LLM 释义）
   - 不显示收藏按钮（已收藏无需重复操作）

#### 触发模式

| 模式 | 设置值 | 行为 | 实现状态 |
|---|---|---|---|
| 划词 + 图标（默认） | `icon` | 选中文字后显示浮标，点击浮标触发查询 | ✅ 已实现 |
| 划词自动弹出 | `auto` | 选中文字后直接弹出释义浮窗，无需点击 | ✅ 已实现 |
| 快捷键 + 划词 | `hotkey` | 选中文字后按快捷键触发 | ⚠️ 设置 UI 已搭建，触发逻辑待实现 |

#### 词形还原策略（Lemmatization）
- **由 LLM 统一处理**：在查词 Prompt 中要求 LLM 返回 `lemma`（单词原形）字段
- 例如用户选中 "investigated"，LLM 返回 `"lemma": "investigate"`
- 生词本中以 `lemma` 作为去重和存储的 key（大小写不敏感匹配）
- 同时保留 `originalForm`（用户选中的原始形态）用于展示上下文
- **不引入本地词形还原库**，以保持零依赖的技术选型

#### 释义浮窗内容
- **单词**：LLM 返回的原形（lemma），加粗 18px
- **音标**：国际音标，灰色 13px
- **中文释义**：LLM 生成的学术语境中文释义（1-2 个主要含义）
- **学术例句**：LLM 生成的 1 个学术语境例句，蓝色左边框斜体卡片
- **原文句子**：自动截取单词在原文中所在的句子（虚线分隔，灰色 12px）

#### 首次使用引导（轻提示）
- **不设置强制引导页面**，用户安装后即可直接使用
- 首次划词查询时，如果未配置 API Key：
  - 释义浮窗中显示友好提示：🔑 图标 + 「需要配置 API Key 才能查词」
  - 提供「前往设置 →」按钮，点击通过 `OPEN_OPTIONS` 消息打开 Options Page
- 首次打开 Popup 时：
  - 生词本为空时显示空状态引导卡片：📚 图标 + 使用方法说明 + 「去设置 API Key →」按钮
- API Key 配置成功后，设置页显示绿色 toast「设置保存成功！现在可以开始划词查询了」

#### 边界情况处理
- 选中内容超过 3 个单词 → 不触发（`isEnglishWord` 校验）
- 选中内容包含非英文字符 → 不触发
- 选中内容为纯数字 → 不触发
- 选中区域 `getBoundingClientRect()` 为零尺寸 → 不触发
- LLM API 调用失败 → 显示错误提示 + 重试按钮
- 未配置 API Key → 显示 `NO_API_KEY` 友好提示
- 页面滚动时 → 自动关闭浮窗和浮标
- 按 Esc → 关闭浮窗和浮标
- 重新选词 → 关闭旧浮窗/浮标，打开新的

#### Shadow DOM 隔离方案（已实现）
- 宿主元素 `<div id="papervocab-root">` 挂载到 `document.documentElement`
- 宿主内联样式：`position:fixed; overflow:visible; pointer-events:none; z-index:2147483647`
- 使用 `attachShadow({ mode: 'closed' })` 完全隔离
- 所有浮窗/浮标样式通过 JS `getShadowStyles()` 注入 Shadow DOM 内部
- `content.css` 文件为空（仅注释），不向宿主页面注入任何样式规则

#### PDF 支持
- 兼容 Chrome 内置 PDF Viewer
- 兼容基于 PDF.js 的在线阅读器（如 arXiv）
- 通过 `matches: ["<all_urls>"]` 注入到所有页面
- 状态：待充分测试验证

### 2.3 Feature 2: 生词本

**入口：点击 Chrome 工具栏的插件图标 → 弹出 Popup**

#### 生词本主界面
- **顶部 header**：📖 logo + "PaperVocab" 标题 + ⚙️ 设置齿轮按钮
- **Tab 栏**：「生词本」|「复习」（active 状态蓝色下划线）
- **搜索框**：带放大镜图标，debounce 300ms，支持搜索单词和释义内容
- **排序按钮组**：三个互斥按钮
  - 「次数」（默认，按 queryCount 降序）
  - 「时间」（按 createdAt 降序）
  - 「字母」（按 word 字母序）
- **单词卡片列表**（每个条目显示）：
  - 单词（15px 加粗）+ 音标（11px 灰色）
  - 中文释义（12px 单行截断 ellipsis）
  - 查询次数蓝色 badge（如 `×3`）
  - 添加日期（11px）

#### 单词详情（点击展开）
- 点击卡片 → 展开显示详情区域
- **完整释义**：支持点击「编辑释义」按钮 → 变为 textarea → 保存/取消
- **学术例句**：蓝色左边框斜体卡片
- **所有查询记录**：每条包含原文句子 + 来源页面标题 + 查询日期
- **操作按钮**：「编辑释义」（蓝色）+ 「删除」（红色）
- 删除操作弹出模态确认对话框（遮罩层 + 取消/删除按钮）

#### 数据统计（底部固定栏）
- 总计: N 词 | 本周 +N | 已掌握 N
- 本周定义：过去 7 天内 `createdAt` 的单词数量
- 已掌握定义：`mastered === true` 的单词数量

### 2.4 Feature 3: 卡片复习

**入口：Popup 中的「复习」Tab**

#### 复习开始界面（idle 状态）
- 大数字显示可复习词数（所有未掌握单词数）
- 复习范围单选：
  - 全部未掌握（默认）：`mastered !== true`
  - 只不认识（level=0）：`mastered !== true && masteryLevel === 0`
  - 高频词（≥3次）：`queryCount >= 3`
  - 随机 N 个：全部单词随机抽取
- 「开始复习」按钮（可复习词数为 0 时禁用）

#### 翻卡片模式（reviewing 状态）
1. **顶部**：← 返回按钮 + 进度 `3/20`
2. **卡片正面**：单词（28px 加粗）+ 查询次数 badge + 「点击翻转查看释义」提示
3. 点击卡片 → CSS 3D 翻转动画（`rotateY(180deg)`, `perspective: 800px`, 0.5s ease）
4. **卡片背面**：单词 + 音标 + 中文释义 + 学术例句
5. **底部三按钮**：
   - ✓ 认识（绿色 `#10B981`）→ masteryLevel +1（最高 3）
   - △ 模糊（黄色 `#F59E0B`）→ masteryLevel 不变
   - ✗ 不认识（红色 `#EF4444`）→ masteryLevel 重置为 0
6. 点击按钮 → 实时写入 `chrome.storage.local` → 自动下一张

#### 掌握度模型
| 自评 | 掌握度变化 |
|---|---|
| 认识 ✓ | `Math.min(masteryLevel + 1, 3)` |
| 模糊 △ | 不变 |
| 不认识 ✗ | 重置为 0 |

- `masteryLevel >= 3` → `mastered = true`，默认不出现在复习池
- 每批次数量由 `reviewBatchSize` 设置控制（默认 20）
- 卡片顺序：Fisher-Yates 随机打乱

#### 复习完成界面（completed 状态）
```
┌───────────────────────────────────┐
│        本轮复习完成！               │
│                                   │
│   ✓ 认识     12 个  （绿底卡片）    │
│   △ 模糊      5 个  （黄底卡片）    │
│   ✗ 不认识    3 个  （红底卡片）    │
│                                   │
│   [ 再来一轮 ]    [ 返回生词本 ]    │
└───────────────────────────────────┘
```

### 2.5 Feature 4: 设置页

**入口：Popup 右上角齿轮图标 → `chrome.runtime.openOptionsPage()`**

#### 设置项（已实现）
| 设置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| LLM 服务商 | 下拉选择 | `openai` | OpenAI / Anthropic Claude / 自定义 |
| API Key | 密码输入框 | 空 | 保存前校验非空 |
| API Base URL | 文本输入框 | 随服务商切换 | 见下表 |
| 模型名称 | 文本输入框 | 随服务商切换 | 见下表 |
| 划词触发方式 | 单选 | `icon` | 划词+图标 / 自动弹出 / 快捷键+划词 |
| 快捷键 | 文本输入（只读，按键捕获） | `Alt` | 仅快捷键模式可见 |
| 每次复习数量 | 数字输入 | `20` | 范围 5-100 |

#### 服务商切换联动
| 服务商 | API Base URL | 默认模型 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Anthropic | `https://api.anthropic.com` | `claude-3-haiku-20240307` |
| 自定义 | 空（用户填写） | 空（用户填写） |

#### 数据管理（已实现）
- **导出 JSON**：生成 `papervocab-export-YYYYMMDD.json`，通过 Blob + `<a>` 触发下载
- **导入 JSON**：file input 读取 → 按 `word` 字段去重合并 → 显示新增/跳过数量
- **清空生词本**：两次 `confirm()` 确认 → 清空 `chrome.storage.local` 的 words 数组
- **底部信息**：显示当前生词本词数
- **保存反馈**：绿色 toast 提示，3 秒自动消失

---

## 3. 数据模型

### 3.1 单词条目 (WordEntry)

```typescript
interface WordEntry {
  id: string;                // UUID v4（generateId 函数生成）
  word: string;              // 单词原形（LLM 返回的 lemma）
  originalForm: string;      // 用户选中的原始形态
  phonetic: string;          // 国际音标
  definition: string;        // LLM 生成的中文释义（用户可编辑）
  example: string;           // LLM 生成的学术例句
  contexts: Context[];       // 查询上下文记录（每次查询追加一条）
  queryCount: number;        // 总查询次数
  masteryLevel: number;      // 掌握度 0-3
  mastered: boolean;         // masteryLevel >= 3 时为 true
  createdAt: string;         // ISO 8601 首次添加时间
  updatedAt: string;         // ISO 8601 最后更新时间
}

interface Context {
  sentence: string;          // 单词在原文中的句子
  sourceTitle: string;       // 页面标题（document.title）
  sourceUrl: string;         // 页面 URL（window.location.href）
  queriedAt: string;         // ISO 8601 查询时间
}
```

### 3.2 用户设置 (UserSettings)

```typescript
interface UserSettings {
  llmProvider: 'openai' | 'anthropic' | 'custom';
  apiKey: string;
  apiBaseUrl: string;
  modelName: string;
  triggerMode: 'icon' | 'auto' | 'hotkey';
  hotkey: string;            // 仅 triggerMode='hotkey' 时有效，默认 'Alt'
  reviewBatchSize: number;   // 每次复习数量，默认 20
}
```

### 3.3 存储方案

| 存储类型 | Chrome API | 用途 | Key | 容量 |
|---|---|---|---|---|
| 主存储 | `chrome.storage.local` | 全部单词数据 | `"words"` → `WordEntry[]` | 无限（`unlimitedStorage`） |
| 同步存储 | `chrome.storage.sync` | 用户设置 | `"settings"` → `UserSettings` | 100KB |
| 备份 | 手动导出/导入 JSON | 数据迁移 | — | 无限 |

> **设计决策**：`chrome.storage.sync` 100KB 上限远不够存储完整生词本，因此单词数据仅存本地，设置通过 sync 跨设备同步，生词本数据通过手动导出/导入迁移。

---

## 4. LLM 接入方案

### 4.1 查词 Prompt

```
你是一个学术英语词汇助手。用户在阅读英文学术论文时遇到一个不认识的单词，请你帮助解释。

单词：{word}
原文句子：{sentence}

请按以下格式返回 JSON：
{
  "lemma": "单词原形",
  "phonetic": "国际音标",
  "definition": "中文释义（聚焦该词在学术语境中的含义，简洁准确，不超过50字）",
  "example": "一个学术场景的英文例句"
}

要求：
1. 释义要贴合学术论文语境，而非日常口语含义
2. 如果该词有多个学术含义，优先给出在原文句子语境中最匹配的含义
3. 例句应来自学术写作场景
4. 严格返回 JSON 格式，不要附加其他内容
```

OpenAI 调用时还会附加 system prompt：`你是一个学术英语词汇助手，帮助用户理解学术论文中的英文生词。请严格按 JSON 格式返回结果。`

### 4.2 多服务商调用细节

| 服务商 | 端点 | 认证方式 | 特殊 Header |
|---|---|---|---|
| OpenAI | `{baseUrl}/chat/completions` | `Authorization: Bearer {apiKey}` | 无 |
| Anthropic | `{baseUrl}/v1/messages` | `x-api-key: {apiKey}` | `anthropic-version: 2023-06-01` + `anthropic-dangerous-direct-browser-access: true` |
| 自定义 | 复用 OpenAI 格式 | 复用 OpenAI 格式 | 无 |

- OpenAI 调用参数：`temperature: 0.3`，带 system + user 两条 messages
- Anthropic 调用参数：`max_tokens: 300`，仅 user 一条 message（Anthropic 不使用 system role 在 messages 中）

### 4.3 调用策略
- **超时**：10 秒（`AbortController`）
- **重试**：自动重试 1 次（间隔 2 秒），仍然失败则显示错误 + 重试按钮
- **已收藏单词**：不调用 LLM，直接本地读取（queryCount++ 和追加 context 仍执行）
- **费用预估**：每次查词约 500 tokens，成本约 $0.0001 - $0.001

### 4.4 响应解析与容错（三级）
1. **直接 `JSON.parse()`** 完整返回文本
2. **正则提取**：`text.match(/\{[\s\S]*?\}/)` 提取第一个 JSON 对象后 parse
3. **全文兜底**：将整段文本作为 `definition` 字段，其他字段留空字符串

缺失字段均以空字符串兜底，不阻断流程。用户可在生词本中手动编辑释义。

---

## 5. 技术方案

### 5.1 技术栈
| 层面 | 技术选型 | 说明 |
|---|---|---|
| 插件标准 | Chrome Extension Manifest V3 | 当前 Chrome 插件最新标准 |
| 前端 | 原生 HTML + CSS + JavaScript | 零依赖，体积小加载快 |
| 后台 | Service Worker（自包含） | MV3 要求，所有 lib 代码内联 |
| 内容脚本 | IIFE + Closed Shadow DOM | 完全样式隔离 |
| 存储 | Chrome Storage API | local（单词）+ sync（设置） |
| API 通信 | Fetch API + AbortController | 调用 LLM API，带超时 |
| 构建 | 无构建工具 | 原生开发，直接加载 |

### 5.2 项目结构

```
papervocab/
├── manifest.json                  # MV3 清单文件
├── claude.md                      # 项目经验备忘录
├── PaperVocab-PRD.md              # 本文件
├── icons/                         # 插件图标（蓝底白字 "PV"）
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   └── service-worker.js          # 后台 Service Worker（自包含全部逻辑）
├── content/
│   ├── content.js                 # 内容脚本（划词 + 浮标 + 浮窗，IIFE 自包含）
│   └── content.css                # 空文件（样式全部在 Shadow DOM 内注入）
├── popup/
│   ├── popup.html                 # 弹出页面骨架
│   ├── popup.js                   # 生词本 + 复习逻辑
│   └── popup.css                  # 弹出页面样式
├── options/
│   ├── options.html               # 设置页面
│   ├── options.js                 # 设置逻辑
│   └── options.css                # 设置页面样式
└── lib/                           # 共享库源码（仅作参考，不在运行时被加载）
    ├── utils.js                   # 工具函数参考源码
    ├── storage.js                 # 存储层参考源码
    └── llm.js                     # LLM 调用参考源码
```

> **重要**：`lib/` 目录下的文件不在运行时被任何模块加载。Service Worker 和 Content Script 各自内联了所需的全部函数。修改逻辑时需同步更新三处副本（lib 源码、service-worker.js 内联、content.js 的 `*Local` 函数）。

### 5.3 Manifest V3 配置

```json
{
  "manifest_version": 3,
  "name": "PaperVocab",
  "version": "1.0.0",
  "description": "学术论文划词生词本 — 智能释义 · 生词积累 · 卡片复习",
  "permissions": ["storage", "unlimitedStorage", "activeTab"],
  "host_permissions": ["https://*/*"],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/content.js"],
    "css": ["content/content.css"],
    "run_at": "document_idle"
  }],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_page": "options/options.html",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 5.4 消息通信协议

Content Script 与 Service Worker 之间通过 `chrome.runtime.sendMessage` 通信：

| 消息类型 | 方向 | 请求参数 | 响应 |
|---|---|---|---|
| `QUERY_WORD` | Content → SW | `{ word, sentence, sourceTitle, sourceUrl }` | `{ exists, wordData }` 或 `{ error }` |
| `SAVE_WORD` | Content → SW | `{ wordData: { word, originalForm, phonetic, definition, example, context } }` | `{ success, wordEntry }` |
| `GET_SETTINGS` | Content → SW | 无 | `{ settings }` |
| `OPEN_OPTIONS` | Content → SW | 无 | `{ success }`（触发 `chrome.runtime.openOptionsPage()`） |

Popup 和 Options 页面直接调用 `chrome.storage.local/sync`，不经过 Service Worker。

---

## 6. UI/UX 设计规范

### 6.1 设计原则
1. **轻量不打扰**：浮窗小巧，不遮挡阅读内容
2. **学术感**：使用清爽的黑白灰 + 蓝色点缀配色
3. **快速响应**：查词到显示释义 < 2 秒体感
4. **完全隔离**：Content Script UI 在 Closed Shadow DOM 中，不影响宿主页面

### 6.2 配色方案
| 用途 | 颜色 | CSS 变量 |
|---|---|---|
| 主色 | `#2563EB` (Blue-600) | `--pv-primary` |
| 主色深 | `#1D4ED8` (Blue-700) | `--pv-primary-dark` |
| 背景 | `#FFFFFF` | `--pv-bg` |
| 浅背景 | `#F9FAFB` (Gray-50) | `--pv-bg-light` |
| 蓝背景 | `#EFF6FF` (Blue-50) | `--pv-bg-blue` |
| 文字主色 | `#1F2937` (Gray-800) | `--pv-text` |
| 文字次色 | `#6B7280` (Gray-500) | `--pv-text-secondary` |
| 文字弱色 | `#9CA3AF` (Gray-400) | `--pv-text-muted` |
| 成功色 | `#10B981` (Green-500) | `--pv-success` |
| 警告色 | `#F59E0B` (Amber-500) | `--pv-warning` |
| 危险色 | `#EF4444` (Red-500) | `--pv-danger` |
| 边框 | `#E5E7EB` (Gray-200) | `--pv-border` |

### 6.3 关键界面

#### 6.3.1 划词浮标图标
- 22×22px 蓝色圆形，白色边框 1.5px，阴影
- 内嵌 SVG "PV" 白色文字
- 位置：选区 `rect.right + 4px`, `rect.top - 26px`
- hover 时 `scale(1.15)` + 蓝色阴影
- 1.5 秒无操作自动消失（mouseenter 暂停倒计时）

#### 6.3.2 释义浮窗
```
┌─────────────────────────────────┐
│ investigate  /ɪnˈvɛstɪˌɡeɪt/   │
│─────────────────────────────────│
│ v. 调查，研究；对…进行系统性考察   │
│                                 │
│ ┃ Several studies have          │
│ ┃ investigated the relationship │
│ ┃ between X and Y.              │
│                                 │
│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ 原文: "...we investigated the   │
│ effects of temperature on..."   │
│─────────────────────────────────│
│                    [ ⭐ 收藏 ]   │
└─────────────────────────────────┘
```
- 最大宽度 360px，最小宽度 260px
- 定位：优先选区下方 8px，空间不足时上方
- 8px 圆角 + 阴影 `0 4px 20px rgba(0,0,0,0.12)`
- 出现动画：`fadeIn 0.18s ease-out`（opacity + translateY）

#### 6.3.3 Popup 生词本
- 尺寸：380×520px
- 自定义 4px 宽滚动条
- 空状态：📚 图标 + 说明文字 + 蓝色按钮

#### 6.3.4 卡片复习
- CSS 3D 翻转：`perspective: 800px`, `transform: rotateY(180deg)`, `backface-visibility: hidden`
- 翻转过渡：`transition: transform 0.5s ease`
- 卡片最小高度 200px，12px 圆角

---

## 7. 非功能需求

### 7.1 性能
| 指标 | 目标 |
|---|---|
| 浮标图标出现延迟 | 选中文字后 < 100ms（实际 ~10ms setTimeout） |
| 释义浮窗加载 | 显示加载态 < 200ms，释义返回 < 3s |
| Popup 打开 | < 500ms 完成渲染 |
| 存储读写 | < 50ms |
| 插件包体积 | < 500KB |
| 内存占用 | Content Script < 5MB |

### 7.2 兼容性
| 环境 | 要求 |
|---|---|
| Chrome 版本 | ≥ 116（MV3 稳定支持） |
| 页面类型 | 普通 HTML 网页、Chrome 内置 PDF Viewer（待验证） |
| 重点适配网站 | arXiv、PubMed、Nature、Science、IEEE、Springer、Google Scholar |

### 7.3 安全性
- API Key 存储在 `chrome.storage.sync`（跨设备同步），不上传到任何第三方服务器
- LLM API 调用仅发送单词和句子片段，不发送整篇论文内容
- Content Script 使用 Closed Shadow DOM 隔离
- 不收集任何用户行为数据

### 7.4 可维护性
- 代码模块化：lib/ 源码 → service-worker.js 内联 → content.js 本地副本
- 关键函数添加 JSDoc 注释
- 统一日志前缀：`[PaperVocab]`
- 项目经验记录在 `claude.md`

---

## 8. 开发状态

### 已完成
- [x] 项目脚手架 + manifest.json
- [x] 图标生成（蓝底白字 "PV"，4 个尺寸）
- [x] 工具函数库（generateId, isEnglishWord, extractSentence, formatDate, debounce, escapeHtml）
- [x] 存储层封装（Word CRUD + Settings CRUD + 导出/导入）
- [x] LLM API 封装（OpenAI + Anthropic + 自定义，含超时/重试/容错）
- [x] Service Worker 消息路由（QUERY_WORD, SAVE_WORD, GET_SETTINGS, OPEN_OPTIONS）
- [x] Content Script 划词检测 + 浮标图标
- [x] Content Script 释义浮窗（Shadow DOM，加载态/结果态/错误态/已收藏态）
- [x] Content Script 收藏功能
- [x] Popup 生词本（搜索、排序、展开详情、编辑释义、删除确认）
- [x] Popup 卡片复习（4 种范围、3D 翻转、三级评分、完成统计）
- [x] Popup 底部统计栏
- [x] Options 设置页（LLM 配置、触发方式、复习数量）
- [x] Options 数据管理（导出/导入 JSON、清空）
- [x] 首次使用引导（无 API Key 提示、空状态引导）
- [x] 边界情况处理（Esc 关闭、滚动关闭、选区校验）

### 待完善
- [ ] 快捷键触发模式（hotkey）：设置 UI 已搭建，content.js 中的键盘监听逻辑待实现
- [ ] PDF 支持：需在 Chrome 内置 PDF Viewer 中充分测试
- [ ] Popup 虚拟滚动：大量单词时的性能优化
- [ ] 生词本单词高亮：在网页上标记已收藏的生词

---

## 9. 开放问题 & 已决事项

| # | 问题 | 状态 |
|---|---|---|
| 1 | Chrome 内置 PDF Viewer 的 Content Script 注入是否在 MV3 下可行？ | 待验证 |
| 2 | `chrome.storage.sync` 100KB 限制下的存储分工？ | **已决定：设置用 sync，单词用 local** |
| 3 | LLM 返回格式不正确时的 fallback 策略？ | **已决定：三级容错（直接 parse → 正则提取 → 全文兜底）** |
| 4 | 单词 lemmatization 是否需要本地库？ | **已决定：由 LLM 处理，零依赖** |
| 5 | MV3 Service Worker 能否用 importScripts？ | **已验证：不能。改为代码内联** |
| 6 | Shadow DOM 宿主元素如何避免被宿主 CSS 影响？ | **已解决：closed mode + 内联样式 + overflow:visible** |
| 7 | DOMRect 活引用导致坐标失效？ | **已解决：立即克隆为普通对象** |

---

## 10. 成功指标

作为个人工具，关注以下使用指标：
- 日均查词次数
- 生词本累计词汇量
- 复习完成率（每次复习是否完成全部卡片）
- 「已掌握」词汇比例增长趋势
