# WordMaster - 英语单词学习辅助系统

本地单机版英语单词学习 Web 应用，支持阅读标注、逐档复习、标签管理、词典管理、用户等级系统等功能。

## 功能特性

- **自适应测评**：通过交互式测评确定用户英语水平等级（从 Level 4 开始）
- **用户等级系统**：根据掌握的词汇量自动升级（掌握 80% 当前等级词汇可升级）
- **文章阅读**：导入英文文章，自动标注词汇难度，支持点击查询
- **划选标注陌生度**：鼠标拖拽选中文字，直接标注为指定陌生度（1/3/5/7/9）
- **自动添加新词**：划选未收录的单词时，自动通过词形还原找到原型并添加到词典
- **陌生度分级**：5 级陌生度（1/3/5/7/9），支持逐档升降或直接设置
- **词典管理**：支持词典词条的增删改查、搜索、分页
- **标签管理**：为文章添加标签，支持批量打标
- **批注系统**：选中文本添加批注
- **数据导出**：支持 JSON/CSV 导出和数据库备份
- **深色模式**：自动切换深色/浅色主题

## 技术栈

- **后端**：Node.js + Express + better-sqlite3
- **前端**：React 18 + Vite + Tailwind CSS
- **数据库**：SQLite（双文件：dictionary.db + userdata.db）
- **词形还原**：自研（lemma_map 340+ 条不规则变化 + 20+ 种规则后缀剥离）

## 快速开始

### 环境要求

- Node.js 18+

### 一键启动

**Linux / Mac / WSL:**
```bash
chmod +x start.sh
./start.sh
```

**Windows:**
```bat
start.bat
```

### 手动启动

```bash
# 安装后端依赖
cd server && npm install

# 安装前端依赖
cd client && npm install

# 初始化数据库
cd server && node database/init.js

# 启动后端（端口 3000）
cd server && node index.js

# 构建前端
cd client && npm run build

# 访问
# 后端同时 serve 前端构建产物，访问 http://localhost:3000
```

## 项目结构

```
wordmaster-local/
├── server/                 # 后端
│   ├── index.js           # 入口
│   ├── config.js          # 配置
│   ├── database/          # 数据库
│   │   ├── connection.js  # 连接管理
│   │   ├── init.js        # 初始化
│   │   ├── migrate.js     # 版本迁移
│   │   └── seed/          # 初始数据（372 词条 + 340 词形映射）
│   ├── routes/            # API 路由
│   │   ├── articles.js
│   │   ├── vocab.js
│   │   ├── tags.js
│   │   ├── annotations.js
│   │   ├── config.js
│   │   ├── export.js
│   │   ├── dictionary.js
│   │   └── levelTest.js
│   ├── services/          # 业务逻辑
│   │   ├── textParser.js  # 文本解析
│   │   ├── strangeness.js # 陌生度计算
│   │   ├── levelTest.js   # 自适应测评
│   │   ├── exportService.js # 导出/恢复
│   │   └── lemmatizer.js  # 词形还原服务
│   └── middleware/
│       └── errorHandler.js
├── client/                # 前端
│   ├── src/
│   │   ├── pages/         # 页面组件（11 个页面）
│   │   ├── components/    # 通用组件
│   │   ├── api/           # API 客户端
│   │   └── utils/         # 工具函数
│   └── ...
├── design.md              # 详细设计文档 V1.1
├── design_bak.md          # 原始设计文档备份
├── start.sh               # 启动脚本 (Linux/Mac)
├── start.bat              # 启动脚本 (Windows)
└── README.md
```

## API 文档

基础 URL: `http://localhost:3000/api`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/config | 获取配置 |
| PUT | /api/config | 更新配置 |
| POST | /api/level-test/start | 开始测评 |
| POST | /api/level-test/feedback | 提交反馈（easy/hard/confirm/skip/cancel） |
| POST | /api/articles | 导入文章 |
| GET | /api/articles | 文章列表 |
| GET | /api/articles/:id | 文章详情 |
| PUT | /api/articles/:id | 更新文章 |
| DELETE | /api/articles/:id | 删除文章 |
| POST | /api/articles/batch-tag | 批量打标 |
| POST | /api/articles/:id/batch-review | 批量复习 |
| GET | /api/vocab | 词汇列表 |
| GET | /api/vocab/stats | 词汇统计 + 升级进度 |
| POST | /api/vocab/upgrade-level | 升级用户等级 |
| GET | /api/vocab/:word_id | 词汇详情 |
| PUT | /api/vocab/:word_id/strangeness | 逐档调整陌生度 |
| PUT | /api/vocab/:word_id/set-strangeness | 直接设置陌生度值 |
| DELETE | /api/vocab/:word_id | 删除词汇 |
| POST | /api/vocab/batch-delete | 批量删除 |
| POST | /api/vocab/custom | 添加自定义词 |
| GET | /api/vocab/review | 复习列表 |
| GET | /api/tags | 标签列表 |
| POST | /api/tags | 创建标签 |
| PUT | /api/tags/:id | 重命名标签 |
| DELETE | /api/tags/:id | 删除标签 |
| POST | /api/dictionary/auto-add | 自动添加单词（词形还原 + 等级估算） |
| GET | /api/dictionary/search | 搜索词典（分页 + 等级筛选） |
| GET | /api/dictionary/:word_id | 词典详情 |
| POST | /api/dictionary | 添加词条 |
| PUT | /api/dictionary/:word_id | 更新词条 |
| DELETE | /api/dictionary/:word_id | 删除词条 |
| GET | /api/export/json | 导出 JSON |
| POST | /api/import/json | 导入 JSON |
| GET | /api/export/csv | 导出 CSV |
| GET | /api/backup/db | 备份数据库 |

## 数据说明

- `server/data/dictionary.db` - 词典数据库（372 词条，Level 1-10 分布）
- `server/data/userdata.db` - 用户数据（配置、词汇、文章、批注、修改日志）
- `server/data/audio/` - 音频文件目录（按首字母分目录）

## 词形还原规则

系统支持以下词形还原规则（按优先级）：

1. **lemma_map 映射表**：340+ 条不规则变化（went→go, cities→city 等）
2. **直接词典查询**：词本身可能就是原型
3. **规则后缀剥离**：
   - `-ied → -y`（carried→carry）
   - `-ing → -e/∅`（making→make, running→run）
   - `-ed → ∅/-e`（walked→walk, hoped→hope）
   - `-er/-est`（bigger→big, biggest→big）
   - `-ly/-ness/-ment/-tion/-sion/-ity` 等学术后缀
   - `-es/-s`（boxes→box, cats→cat）

## 新词等级估算

当用户划选未收录的单词时，系统通过以下启发式规则估算等级：

| 条件 | 等级 |
|------|------|
| 词长 ≤ 3 | Level 2 |
| 词长 = 4 | Level 3 |
| 含学术后缀（-tion/-sion/-ment 等） | Level 6 |
| 含中等后缀（-ful/-less/-ly 等） | Level 5 |
| 词长 ≥ 10 | Level 7 |
| 词长 ≥ 8 | Level 6 |
| 默认 | Level 5 |
