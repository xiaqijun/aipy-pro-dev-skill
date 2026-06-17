---
name: aipy-pro-dev
description: 当构建、修改或调试 AiPy Pro 智能体扩展时使用 — 包括创建 manifest.json、编写 MCP 服务端代码、使用 DXT 打包、或准备上架 AiPy Pro 智能体集市。当任务提及 AiPy、AiPy Pro、DXT、MCPB、@aipy-pro 扩展、或 Streamable HTTP MCP 服务时也应使用。
---

# AiPy Pro 智能体开发

## 概述

AiPy Pro 扩展是基于 **Anthropic DXT（MCPB）** 构建的 MCP 服务，并新增了适配 AiPy Pro 智能体集市的远程分发能力。一个扩展是 `@aipy-pro/<智能体名>/` 下的独立目录，包含 `manifest.json`、入口文件和图标。

**核心约束：** AiPy Pro **仅**支持 **Streamable HTTP Server** 传输方式。在对话上下文中**不支持** Stdio。

## 速查表

| 要求 | 规则 |
|------|------|
| 传输协议 | **仅 Streamable HTTP**（严禁 stdio） |
| 端口 | **随机端口** — 绑定端口 0，AiPy 为每个任务启动独立实例 |
| STDOUT | 服务启动监听后，**必须打印实际端口号** |
| manifest `keywords` | 必须包含 `"conversation-tool"` |
| manifest `server.type` | `"node"` → Electron 运行时 fork 启动；其他值 → 创建子进程启动 |
| 系统提示词注入 | 提供名为 `addition-system-instruction` 的 Prompt |
| 构建 | `npx @anthropic-ai/dxt pack` |
| 图标 | 必须提供：扩展根目录下的 `icon.svg` |
| 依赖 | 通过 DXT pack 打包 — 运行时不需要 npm install |

## 目录结构

扩展位于 AiPy Pro 的扩展安装目录（按平台区分）：

```
# Windows
C:\Users\<用户名>\AppData\Roaming\aipy-pro\extensions

# macOS
~/Library/Application Support/aipy-pro/extensions

# Linux
~/.config/aipy-pro/extensions
```

**扩展目录布局：**
```
@aipy-pro/
└── <智能体名>/
    ├── icon.svg          # 必须 — SVG 图标
    ├── manifest.json     # 必须 — MCPB 元数据
    └── server.js         # 必须 — 入口文件（或其他配置的入口）
```

本地测试时，将扩展复制到对应平台的 extensions 目录下的 `@aipy-pro/<智能体名>/` 中。

## manifest.json 规范

基于 MCPB 规范，通过 `keywords` 字段扩展 AiPy 专有属性。

```json
{
    "dxt_version": "0.1",
    "name": "@aipy-pro/<智能体名>",
    "display_name": "<可读名称>",
    "version": "1.0.0",
    "description": "<描述>",
    "author": { "name": "<作者>" },
    "icon": "icon.svg",
    "server": {
        "type": "node",
        "entry_point": "server.js",
        "mcp_config": {
            "command": "node",
            "args": ["${__dirname}/server.js"],
            "env": {}
        }
    },
    "keywords": ["conversation-tool"]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `dxt_version` | 是 | 固定为 `"0.1"` |
| `name` | 是 | 带作用域：`@aipy-pro/<名称>` |
| `display_name` | 是 | 在市场中展示的可读名称 |
| `version` | 是 | 语义化版本号 |
| `description` | 是 | 在市场列表中展示的说明 |
| `author` | 是 | `{ "name": "..." }` 对象 |
| `icon` | 是 | 扩展根目录下的 SVG 文件名 |
| `server.type` | 是 | `"node"` → Electron fork 启动；其他 → 子进程启动 |
| `server.entry_point` | 是 | 入口文件（如 `"server.js"`） |
| `server.mcp_config` | 是 | 启动服务的命令、参数和环境变量 |
| `keywords` | 是 | 工具智能体必须包含 `"conversation-tool"`；独立应用使用 `"application"` |

### keywords 取值

- **`conversation-tool`** — 对话时使用的 MCP 工具（工具型智能体**必填**）
- **`application`** — 独立运行的程序（非对话工具）

## 运行时环境变量

AiPy Pro 会将当前配置的模型信息注入到服务进程的环境中：

| 变量 | 说明 |
|------|------|
| `MODEL_PROVIDER` | 固定为 `"trustoken"` |
| `TRUSTOKEN_API` | Trustoken API 地址（如 `https://api.trustoken.cn`） |
| `TRUSTOKEN_BASE_URL` | Trustoken 模型 API 地址（如 `https://api.trustoken.cn/v1`） |
| `TRUSTOKEN_API_KEY` | API 密钥（格式：`sk-xxx`） |
| `TRUSTOKEN_MODEL` | 模型名（如 `"auto"`） |

可在智能体工具中读取这些变量来调用已配置的模型。

## 服务端实现规范

### 1. Streamable HTTP Server（强制）

使用 `@modelcontextprotocol/sdk` 的 **Streamable HTTP 传输** — **严禁**使用 stdio：

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());

const server = new McpServer({
  name: "<智能体名>",
  version: "1.0.0",
});

// 通过 server.registerTool(...) 注册工具

// 必须：随机端口
const PORT = 0; // 或：动态查找空闲端口
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // 每个请求无状态
});
await server.connect(transport);

app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

const listener = app.listen(PORT, () => {
  const actualPort = listener.address().port;
  // 必须打印到 STDOUT — AiPy 通过解析此输出来发现端口
  console.log(`MCP server listening on port ${actualPort}`);
});
```

### 2. 随机端口 + STDOUT 打印（强制）

- 绑定端口 `0`（由操作系统分配空闲端口）
- 在 `app.listen()` 回调中，通过 `listener.address().port` 获取实际端口
- **将端口号打印到 STDOUT**（使用 `console.log`，不要用 `console.error`）
- AiPy Pro 通过解析 STDOUT 来发现端口 — 缺失此步骤，智能体**无法连接**

### 3. 系统提示词注入（推荐）

注册一个名称**精确**为 `addition-system-instruction` 的 Prompt：

```js
server.registerPrompt(
  "addition-system-instruction",
  {
    title: "附加系统指令",
    description: "在加载此智能体时注入到任务系统提示词的指令",
  },
  async () => {
    return {
      messages: [{
        role: "assistant",
        content: {
          type: "text",
          text: "<!-- 在此填写附加指令 -->",
        },
      }],
    };
  },
);
```

## 推荐开发模型

开发 AiPy Pro 智能体推荐使用以下模型：

- **DeepSeek-v4-pro**（主力）
- **DeepSeek-v4-flash**（更快速、轻量任务）
- **GLM-5.1**
- **GLM-5**

## 数据安全

**强制要求：** 开发过程中如需使用测试数据，必须使用**脱敏后**的数据，严禁使用真实敏感数据。

## 构建与打包

```bash
npx @anthropic-ai/dxt pack
```

生成可发布到 AiPy Pro 智能体集市的包。

## AiPy Pro 智能体交付物

提交完成的 AiPy Pro 智能体时，需提供以下结构：

```
<智能体名称>/
├── 提示词/                  # 开发过程中用到的所有任务提示词
│   ├── 任务1.txt
│   ├── 任务2.txt
│   └── ...
├── 任务工作目录.zip          # AiPy 开发智能体时的完整工作目录
└── 成品/                    # 打包后的智能体
    ├── <智能体名称>.zip      # DXT 包
    ├── <智能体名称>.exe      # Windows 应用（可选）
    └── <智能体名称>.app      # Mac 应用（可选）
```

**类型要求：**
- **通用智能体**（本公司可用、其他公司也能用）：**必须**做成带 UI 的 Web 智能体
- **内部专用智能体**（仅公司内部使用）：无 UI 要求，类型不限

## 常见错误

| 错误 | 正确做法 |
|------|----------|
| 使用 `StdioServerTransport` | 必须使用 `StreamableHTTPServerTransport` — stdio 不被支持 |
| 固定端口号（如 3000） | 绑定端口 `0`，打印系统分配的实际端口 |
| 打印到 stderr 而非 stdout | 端口号必须打印到 STDOUT（`console.log`） |
| `keywords` 缺少 `conversation-tool` | 必须添加 `"keywords": ["conversation-tool"]` |
| 遗漏 `dxt_version` | 必须添加 `"dxt_version": "0.1"` |
| 缺少完整的 `server` 配置块 | `server` 对象必须包含 `type`、`entry_point`、`mcp_config` |
| 在 package.json 中添加 npm 依赖 | AiPy 使用 DXT pack 构建时打包依赖 |
| 照搬 `@modelcontextprotocol/sdk` 的 stdio 示例 | AiPy 托管扩展运行 — 传输方式必须是 Streamable HTTP |
| 在 mcp_config args 中写死端口 | 不要在 args 中传 `--port`，让服务端自行选择端口 |
| 未提供 `addition-system-instruction` prompt | 虽非强制，但推荐提供以支持上下文注入 |
