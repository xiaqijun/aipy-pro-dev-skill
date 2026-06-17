# NetTopology — 网络拓扑识别智能体设计文档

**版本:** v1.0
**日期:** 2026-06-17
**类型:** AiPy Pro MCP 智能体扩展（通用 · Web UI）

---

## 1. 产品概述

### 1.1 定位

面向安全工程师和网络管理员的通用智能体工具。用户通过 AiPy Pro 对话发起扫描，智能体自动完成 L2+L3 网络拓扑发现，在 AiPy 客户端内以交互式拓扑图呈现结果。

### 1.2 核心价值

- **一键发现**：从单台接入主机出发，自动识别内网全部存活网段
- **L2+L3 全覆盖**：MAC 层物理连接 + IP 层路由关系同时呈现
- **设备角色识别**：自动判定路由器、交换机、防火墙、终端
- **可视化交互**：深度交互拓扑图，子网折叠、路径高亮、历史对比

### 1.3 非目标（明确排除）

- IPv6 支持（标记 v2）
- Wi-Fi / 无线拓扑（标记 v2）
- 实时流量监控
- 漏洞扫描或渗透测试功能

---

## 2. 技术架构

### 2.1 整体架构

```
AiPy Pro 客户端
    │
    ├── 对话面板 ←─ Streamable HTTP ──→ ┌─────────────────────────┐
    │                                   │  Node.js MCP Server      │
    └── UI 面板 ←── 内嵌 Web ──────────→│  (Electron fork 启动)     │
                                        │                          │
                                        │  ┌────────────────────┐  │
                                        │  │ 扫描引擎            │  │
                                        │  │  ├─ 网段识别        │  │
                                        │  │  ├─ 主机发现        │  │
                                        │  │  ├─ 端口/服务扫描   │  │
                                        │  │  ├─ 路由追踪        │  │
                                        │  │  └─ SNMP 数据采集   │  │
                                        │  └────────┬───────────┘  │
                                        │           │               │
                                        │  ┌────────┴───────────┐  │
                                        │  │ 拓扑分析引擎         │  │
                                        │  │  ├─ 设备角色判定     │  │
                                        │  │  ├─ 连接关系推断     │  │
                                        │  │  └─ 边界发现         │  │
                                        │  └────────┬───────────┘  │
                                        │           │               │
                                        │  ┌────────┴───────────┐  │
                                        │  │ Web UI Server       │  │
                                        │  │  ├─ 拓扑可视化      │  │
                                        │  │  ├─ 扫描进度        │  │
                                        │  │  └─ 历史对比        │  │
                                        │  └────────────────────┘  │
                                        │                          │
                                        │  ┌────────────────────┐  │
                                        │  │ 数据层              │  │
                                        │  │  ├─ SQLite（持久化）│  │
                                        │  │  └─ 内存缓存         │  │
                                        │  └────────────────────┘  │
                                        └─────────────────────────┘
```

### 2.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| MCP 运行时 | Node.js | AiPy Pro Electron fork 原生支持 |
| MCP SDK | `@modelcontextprotocol/sdk` | Streamable HTTP transport |
| Web 框架 | Express.js | 轻量，与 MCP transport 共用端口 |
| 拓扑可视化 | Cytoscape.js | 专为图设计，内置图算法，compound nodes |
| 数据存储 | better-sqlite3 | 本地 SQLite，无需外部服务 |
| 系统扫描工具 | nmap, arp-scan, traceroute | 行业标准，降级有备选方案 |

### 2.3 部署方式

- `server.type: "node"` — Electron fork 启动
- 单端口随机分配 + STDOUT 打印
- DXT pack 打包发布
- 扩展目录: `@aipy-pro/net-topology/`

---

## 3. 功能设计

### 3.1 MCP 工具清单

| 工具名 | 功能 | 输入 | 输出 | 耗时 |
|--------|------|------|------|------|
| `discover_subnets` | 网段识别（5种方法） | 本机网卡信息 | 候选网段清单 | 快 (~10s) |
| `probe_subnet` | 单网段存活验证 | CIDR | 存活主机数 | 快 (~5s) |
| `discover_hosts` | ARP + ICMP 主机发现 | CIDR | 存活主机列表 | 中 (~30s) |
| `scan_host` | 端口/服务/OS 深度扫描 | IP | 主机指纹详情 | 中 (~60s) |
| `trace_route` | 路由追踪 | 源IP, 目标IP | 路径跳点列表 | 中 (~20s) |
| `identify_device` | 设备角色判定 | IP + 扫描数据 | 路由器/交换机/终端/防火墙 | 快 (本地计算) |
| `build_topology` | 构建拓扑图 | 所有扫描数据 | 拓扑 JSON | 快 (本地计算) |
| `save_snapshot` | 保存拓扑快照 | 名称 | 快照 ID | 快 |
| `load_snapshot` | 加载历史快照 | 快照 ID | 拓扑 JSON | 快 |
| `compare_snapshots` | 两次快照 diff | ID1, ID2 | 差异拓扑 JSON | 快 |
| `export_topology` | 导出拓扑数据 | 格式(JSON/CSV) | 文件 | 快 |
| `cancel_scan` | 取消当前扫描 | — | 已取消确认 | 快 |
| `full_scan` | 一键全流程 | 起始子网 + 凭证 + 速率配置 | 完整拓扑图 | 慢 (分钟级) |

### 3.2 网段识别

五层方法：

1. **路由表读取** — `route -n` / `ip route show`，排除 0.0.0.0/0 和公网路由
2. **ARP 缓存扩展** — 提取非本子网私有 IP，加入候选
3. **SNMP 路由表** — 从路由器读取完整路由表（需凭证）
4. **DNS 反向区域** — 探测 in-addr.arpa NS 记录
5. **启发式推测** — 常见网段枚举 + 网关相邻推测

大网段拆分: 对 /8、/16 网段，并发探测每个 /24 的 .1 和 .254，200ms timeout，100并发 → 约131秒完成 65536 个 /24 的快速甄别。

### 3.3 路由器发现

| 规则 | 原理 | 置信度 |
|------|------|--------|
| 多宿主检测 | 同一 MAC 出现在 ≥2 个子网 | 高 |
| Traceroute 中间跳 | 路径中出现的 IP 非目标 | 高 |
| TTL 探测 | TTL=1 触发 ICMP Time Exceeded | 高 |
| 端口指纹 | 179/BGP、520/RIP、161/SNMP | 中 |
| OUI 厂商匹配 | MAC 前缀 → Cisco/Juniper/Huawei | 低（需组合） |

判定: 满足任一条高置信度规则 → 路由器；OUI + 端口组合 → 路由器（中置信度）。

### 3.4 交换机发现

| 方法 | 原理 | 依赖 |
|------|------|------|
| SNMP MAC 地址表 | dot1dTpFdbTable — MAC→端口映射 | SNMP community |
| LLDP 邻居 | lldpRemTable — 对端设备/端口 | SNMP + LLDP 支持 |
| ARP 表交叉比对 | 一设备 ARP 表有大量条目 → 可能是交换机管理地址 | 无（启发式） |
| 被动指纹 | OUI + 端口组合 + 不在 traceroute 路径 | 无 |

判定: SNMP 返回 MAC 表或 LLDP → 交换机（置信度高）；ARP 表异常丰富 + OUI 网络厂商 → 交换机（置信度中）。

### 3.5 网络边界发现

| 边界类型 | 检测方法 | 关键指标 |
|----------|----------|----------|
| NAT/公网边界 | RFC1918 地址判断 + traceroute 出口跟踪 | 最后一个私有IP → 下一个公网IP |
| 防火墙 | 可达性矩阵 + TTL 跳变 + 端口指纹 | 不对称可达 + 管理端口组合 |
| VLAN/子网边界 | SNMP vlanTable + ARP 广播域测试 | VLAN ID + 广播域不互通 |
| DMZ | 访问不对称性 + 主机密度 + 服务面 | 单向可达 + 服务集中 Web/DNS |

### 3.6 拓扑可视化

**技术:** Cytoscape.js，力导向布局 + 提供 4 种布局切换

**三层视图:**
- **物理拓扑** — L2 MAC 地址连接，按交换机端口分组
- **逻辑拓扑** — L3 IP 路由关系，按子网分组
- **扫描历史** — 时间线 + 两次扫描 diff 对比

**交互能力:**
- 拖拽/缩放/双击聚焦
- 子网 compound node 折叠/展开
- 选中两节点 → 最短路径高亮
- 扫描中实时动画（新节点脉冲效果）
- 节点详情侧栏（IP、MAC、OS、端口、服务）
- 4 种布局切换（力导向/环形/树形/网格）
- 历史对比：新增(绿)/消失(红)/变更(黄)

### 3.7 安全控制

**三级速率限制:**
- 全局: 默认 20 并发，ARP 间隔 50ms，ICMP 间隔 100ms，TCP 50pps
- 每目标: 单 IP 最大 100端口/s，10 并发连接
- 自适应: 目标丢包 > 30% → 自动降速 50%；无响应 3 次 → 标记 dead

**扫描前警告:** 显示目标网段列表、速率配置、黑名单状态。用户确认后启动。

**黑名单:** 用户可标记不扫描的 IP/网段，持久化到本地配置。

### 3.8 凭证管理

- SNMP v2c community (默认 public/private，可自定义)
- SNMP v3 (可选: username + auth + privacy)
- SSH 凭据 (密码或私钥，用于网络设备配置读取)
- **安全约束:** 凭证仅存内存，不落盘，不打印日志
- **使用策略:** 自动尝试每个凭据，超时 3s，失败下一个

### 3.9 错误降级

| 缺失条件 | 降级行为 | 影响 |
|----------|----------|------|
| 无 root/管理员 | 跳过 ARP 扫描，用 ICMP + TCP | L2 拓扑不可用 |
| 无 nmap | Node.js 原生 net 模块端口扫描 | 速度降 60% |
| SNMP 全部不通 | 跳过 SNMP，纯启发式 | 交换机识别置信度降 |
| 端口被防火墙拦截 | 标记 filtered，参与拓扑推断 | 边界发现更准 |
| 超时 | 重试 2 次 (间隔 1s, 3s) | 仍超时 → 标记 dead |
| 无外网 | 跳过公网 IP 判断 | NAT 边界不可检测 |
| DNS 不可用 | 跳过反向区域探测 | 网段识别少一个数据源 |
| traceroute 被拦截 | ICMP → TCP traceroute 到 80 端口 | 部分路径可能不完整 |

### 3.10 数据持久化

- SQLite (`better-sqlite3`) 本地存储
- `scan_history`: 每次扫描的完整拓扑快照
- `device_cache`: 设备指纹缓存 (MAC/IP/OS/类型)
- 凭证**不落盘**，仅内存持有，会话结束即丢弃
- 自动清理 30 天前历史
- 最近 20 次扫描列表可浏览

### 3.11 导出

**MVP (首版):** JSON (完整拓扑数据)、CSV (设备清单表格)
**v2:** PNG、SVG、GraphML (Gephi/Neo4j)

---

## 4. 数据模型

### 4.1 拓扑 JSON

```json
{
  "scanId": "scan_20260617_143052",
  "createdAt": "2026-06-17T14:30:52Z",
  "subnetsScanned": ["192.168.1.0/24", "10.0.0.0/24"],
  "topology": {
    "nodes": [
      {
        "id": "192.168.1.1",
        "mac": "aa:bb:cc:dd:ee:ff",
        "type": "router",
        "roleConfidence": 0.95,
        "hostname": "gw-main",
        "os": "Linux 4.19",
        "vendor": "Cisco Systems",
        "ports": [
          { "port": 22, "service": "ssh", "version": "OpenSSH 8.4" },
          { "port": 443, "service": "https" }
        ],
        "layer": 3,
        "subnet": "192.168.1.0/24",
        "isGateway": true
      }
    ],
    "edges": [
      {
        "source": "192.168.1.100",
        "target": "192.168.1.1",
        "type": "l3_route",
        "confidence": 0.9,
        "method": "traceroute_hop1",
        "label": "hop=1"
      }
    ]
  },
  "boundaries": [
    {
      "type": "nat",
      "deviceId": "192.168.1.254",
      "internalIp": "192.168.1.254",
      "externalIp": "203.0.113.5"
    },
    {
      "type": "vlan",
      "subnetA": "192.168.1.0/24",
      "subnetB": "10.0.0.0/24",
      "gatewayId": "192.168.1.1",
      "vlanId": 100
    },
    {
      "type": "firewall",
      "deviceId": "10.0.0.254",
      "blockedPorts": [3306, 6379],
      "reachabilityMatrix": { }
    }
  ],
  "statistics": {
    "hostsFound": 23,
    "routers": 2,
    "switches": 1,
    "firewalls": 1,
    "endpoints": 19,
    "edgesFound": 18,
    "subnetsFound": 2,
    "scanDurationMs": 185000
  }
}
```

### 4.2 扫描进度

```json
{
  "scanId": "scan_20260617_143052",
  "phase": "host_discovery",
  "status": "running",
  "phases": [
    { "name": "subnet_detect",  "total": 1,  "done": 1, "status": "done" },
    { "name": "host_discovery", "total": 15, "done": 8, "status": "running" },
    { "name": "port_scan",      "total": 42, "done": 0, "status": "pending" },
    { "name": "topology_build", "total": 1,  "done": 0, "status": "pending" }
  ],
  "current": {
    "subnet": "192.168.1.0/24",
    "target": "192.168.1.42",
    "action": "TCP SYN scan ports 1-1000",
    "elapsed": "00:02:35",
    "eta": "00:04:20"
  },
  "intermediate": {
    "hostsFound": 23,
    "routersFound": 2,
    "switchesFound": 1,
    "edgesFound": 18
  }
}
```

---

## 5. 文件结构

```
@aipy-pro/net-topology/
├── icon.svg                    # 图标
├── manifest.json               # MCPB 元数据
├── server.js                   # 入口: Express + MCP transport
├── package.json
│
├── src/
│   ├── mcp/
│   │   ├── tools.js            # MCP 工具注册
│   │   └── prompts.js          # addition-system-instruction
│   │
│   ├── scanner/
│   │   ├── subnet-discovery.js # 网段识别 (5种方法)
│   │   ├── host-discovery.js   # ARP + ICMP 主机发现
│   │   ├── port-scanner.js     # 端口/服务/OS 扫描
│   │   ├── traceroute.js       # 路由追踪
│   │   ├── snmp.js             # SNMP 数据采集
│   │   └── rate-limiter.js     # 速率控制
│   │
│   ├── analyzer/
│   │   ├── device-role.js      # 路由器/交换机/防火墙判定
│   │   ├── topology-builder.js # 拓扑图构建
│   │   ├── boundary-detector.js# 网络边界发现
│   │   └── heuristics.js       # 启发式规则
│   │
│   ├── ui/
│   │   ├── index.html          # Web UI 入口
│   │   ├── app.js              # Cytoscape.js 拓扑渲染
│   │   ├── styles.css
│   │   └── static/             # 图标/字体等
│   │
│   ├── storage/
│   │   ├── database.js         # SQLite 操作
│   │   └── migrations.js       # 表结构迁移
│   │
│   ├── export/
│   │   ├── json-export.js
│   │   └── csv-export.js
│   │
│   └── security.js             # 凭证管理 (内存隔离)
│
└── test/
    ├── scanner/
    ├── analyzer/
    └── fixtures/
```

---

## 6. manifest.json

```json
{
    "dxt_version": "0.1",
    "name": "@aipy-pro/net-topology",
    "display_name": "NetTopology",
    "version": "1.0.0",
    "description": "网络拓扑自动发现与可视化 — 主动扫描 L2/L3 拓扑，识别路由器、交换机、防火墙和网络边界",
    "author": { "name": "AiPy Pro Developer" },
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

---

## 7. MCP Server 入口骨架

```js
// server.js
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./src/mcp/tools.js";
import { registerPrompts } from "./src/mcp/prompts.js";
import { initDatabase } from "./src/storage/database.js";

const app = express();
app.use(express.json());
// UI 静态资源与 API
app.use("/ui", express.static("src/ui"));
app.get("/api/progress/:scanId", handleProgress);    // SSE 进度推送
app.get("/api/snapshots", handleListSnapshots);
app.put("/api/scan/cancel", handleCancelScan);

const server = new McpServer({
  name: "@aipy-pro/net-topology",
  version: "1.0.0",
});

registerTools(server);
registerPrompts(server);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
await server.connect(transport);
app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

await initDatabase();

const listener = app.listen(0, () => {
  console.log(`MCP server listening on port ${listener.address().port}`);
});
```

---

## 8. 开发阶段

| 阶段 | 内容 | 产出 |
|------|------|------|
| **Phase 1: MVP** | 网段识别 + 主机发现 + 端口扫描 + 拓扑构建 + 基础可视化 | 可用的单次扫描 |
| **Phase 2: 核心** | 设备角色判定 + 边界发现 + 安全控制 + 凭证管理 | 完整拓扑识别 |
| **Phase 3: 体验** | 进度反馈 + 错误降级 + 数据持久化 + 导出 | 产品化 |
| **Phase 4: 进阶** | 历史对比 + 自定义布局 + 性能优化 | 完整体验 |
| **v2** | IPv6、Wi-Fi、GraphML 导出、被动监听模式 | 后续迭代 |

---

## 9. 安全注意事项

- 主动扫描必须经过用户确认，展示目标范围和速率
- 扫描速率可配置且有上限，防止 DoS 效应
- 凭据仅存内存，不写入日志/文件/SQLite
- 黑名单机制，尊重用户标记的禁区
- 发现结果仅保留在本地，不上传云端
- OUI 数据库随包内嵌，不需要网络查询
