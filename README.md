# AiPy Pro 智能体开发技能

Claude Code 技能，提供 AiPy Pro 智能体扩展开发的完整参考指南 — 基于 Anthropic DXT (MCPB)，涵盖 manifest.json 规范、MCP Streamable HTTP Server 实现、运行时环境变量、构建打包、交付标准。

## 安装

### 方式一：用户级安装（所有项目可用）

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/xiaqijun/aipy-pro-dev-skill.git ~/.claude/skills/aipy-pro-dev
```

### 方式二：项目级安装（仅当前项目可用）

```bash
mkdir -p .claude/skills
git clone https://github.com/xiaqijun/aipy-pro-dev-skill.git .claude/skills/aipy-pro-dev
```

### 方式三：手动复制

将 `SKILL.md` 复制到 `~/.claude/skills/aipy-pro-dev/` 或 `<项目>/.claude/skills/aipy-pro-dev/` 目录下。

### 验证安装

重启 Claude Code 后，在对话中输入任意 AiPy Pro 开发相关的问题，技能会自动加载。也可通过可用技能列表确认。

## 技能内容

| 模块 | 内容 |
|------|------|
| 速查表 | 9 条核心规则一键查阅 |
| 目录结构 | 扩展安装路径、文件布局 |
| manifest.json | 完整 JSON 示例 + 逐字段说明 |
| 环境变量 | 5 个运行时注入的 Trustoken 变量 |
| Server 实现 | Streamable HTTP（强制）、随机端口 + STDOUT、系统提示词注入 |
| 构建打包 | `npx @anthropic-ai/dxt pack` |
| 交付标准 | 交付物结构、通用/内部智能体类型要求 |
| 常见错误 | 10 条错误与正确做法对照 |

## 依赖

- Claude Code（技能运行时）
- 实际开发 AiPy Pro 扩展需要：Node.js ≥ 18、`@modelcontextprotocol/sdk`、`@anthropic-ai/dxt`

## 参考资料

- [AiPy Pro 智能体开发指南](https://www.aipyaipy.com/ext/)
- [MCPB manifest.json 规范](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)
- [AiPy 官网](https://www.aipyaipy.com/)

## 许可

MIT
