# NetTopology Phase 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal working AiPy Pro MCP agent that discovers network topology from a single subnet scan — host discovery, port scanning, basic topology graph, and interactive Cytoscape.js visualization.

**Architecture:** Node.js Express server with Streamable HTTP MCP transport (single port). Scanner modules shell out to system tools (arp-scan, nmap, traceroute) with native fallbacks. Topology builder produces nodes + edges JSON. Web UI renders with Cytoscape.js served from `/ui`.

**Tech Stack:** Node.js ≥18, `@modelcontextprotocol/sdk`, Express.js, Cytoscape.js, better-sqlite3

## Global Constraints

- `manifest.json` MUST include `"dxt_version": "0.1"`, `"keywords": ["conversation-tool"]`, `"server.type": "node"`
- Server MUST bind port `0`, print actual port to STDOUT via `console.log`
- MCP transport MUST be Streamable HTTP (never stdio)
- All code ESM (`"type": "module"` in package.json)
- Credentials never written to disk or logs
- Scan results stored locally only
- No npm dependencies at runtime — DXT pack handles bundling

---

## File Structure (Phase 1)

```
@aipy-pro/net-topology/
├── icon.svg
├── manifest.json
├── package.json
├── server.js
└── src/
    ├── mcp/
    │   ├── tools.js
    │   └── prompts.js
    ├── scanner/
    │   ├── subnet-discovery.js
    │   ├── host-discovery.js
    │   ├── port-scanner.js
    │   ├── traceroute.js
    │   └── rate-limiter.js
    ├── analyzer/
    │   └── topology-builder.js
    └── ui/
        ├── index.html
        ├── app.js
        └── styles.css
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `@aipy-pro/net-topology/package.json`
- Create: `@aipy-pro/net-topology/manifest.json`
- Create: `@aipy-pro/net-topology/icon.svg`
- Create: `@aipy-pro/net-topology/.gitkeep` for empty dirs

**Produces:** Project root with all config files, `npm install` succeeds.

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p @aipy-pro/net-topology/src/{mcp,scanner,analyzer,ui}
```

- [ ] **Step 2: Write package.json**

```json
{
  "name": "@aipy-pro/net-topology",
  "version": "1.0.0",
  "description": "网络拓扑自动发现与可视化智能体",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test --test-reporter spec test/**/*.test.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "express": "^4.18.0",
    "better-sqlite3": "^11.0.0",
    "cidr-regex": "^4.0.0"
  }
}
```

- [ ] **Step 3: Write manifest.json**

```json
{
    "dxt_version": "0.1",
    "name": "@aipy-pro/net-topology",
    "display_name": "NetTopology",
    "version": "1.0.0",
    "description": "网络拓扑自动发现与可视化 — 主动扫描 L2/L3 拓扑",
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

- [ ] **Step 4: Write icon.svg (minimal placeholder)**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="#1a73e8" stroke="#fff" stroke-width="3"/>
  <circle cx="32" cy="32" r="8" fill="#fff"/>
  <line x1="32" y1="4" x2="32" y2="24" stroke="#fff" stroke-width="2"/>
  <line x1="32" y1="40" x2="32" y2="60" stroke="#fff" stroke-width="2"/>
  <line x1="4" y1="32" x2="24" y2="32" stroke="#fff" stroke-width="2"/>
  <line x1="40" y1="32" x2="60" y2="32" stroke="#fff" stroke-width="2"/>
</svg>
```

- [ ] **Step 5: Install dependencies**

```bash
cd @aipy-pro/net-topology && npm install
```

- [ ] **Step 6: Commit**

```bash
git add @aipy-pro/net-topology/
git commit -m "feat: scaffold NetTopology project with manifest, package.json, icon"
```

---

### Task 2: Server Entry Point

**Files:**
- Create: `@aipy-pro/net-topology/server.js`
- Create: `@aipy-pro/net-topology/src/mcp/tools.js` (skeleton)
- Create: `@aipy-pro/net-topology/src/mcp/prompts.js`

**Consumes:** package.json, manifest.json from Task 1
**Produces:** `server.listen(0)`, MCP transport connected, `/mcp` endpoint, `/ui` static serving

- [ ] **Step 1: Write prompts.js**

```js
// src/mcp/prompts.js
export function registerPrompts(server) {
  server.registerPrompt(
    "addition-system-instruction",
    {
      title: "附加系统指令",
      description: "在加载 NetTopology 智能体时注入到任务系统提示词的指令",
    },
    async () => {
      return {
        messages: [{
          role: "assistant",
          content: {
            type: "text",
            text: "<!-- NetTopology: 你可以使用网络拓扑发现工具。从 discover_subnets 开始识别内网网段，然后用 full_scan 一键完成拓扑扫描。扫描结果会在右侧 UI 面板渲染为交互式拓扑图。 -->",
          },
        }],
      };
    },
  );
}
```

- [ ] **Step 2: Write tools.js skeleton**

```js
// src/mcp/tools.js
import { discoverSubnets } from "../scanner/subnet-discovery.js";
import { discoverHosts } from "../scanner/host-discovery.js";
import { scanHost } from "../scanner/port-scanner.js";
import { traceRoute } from "../scanner/traceroute.js";
import { buildTopology } from "../analyzer/topology-builder.js";

function withHostPort(host, port) {
  const h = host.includes(":") ? `[${host}]` : host;
  return `${h}:${port}`;
}

function makeTopologyUrl(scanId) {
  const port = process.env.AIPY_PORT || "3000";
  const host = process.env.AIPY_HOST || "localhost";
  return `http://${withHostPort(host, port)}/ui?scanId=${scanId}`;
}

export function registerTools(server, { getScanState, setScanState }) {
  server.registerTool(
    "discover_subnets",
    {
      title: "发现内网网段",
      description: "从本机路由表、ARP 缓存和启发式推测中识别内网存活网段。",
      inputSchema: {
        type: "object",
        properties: {
          includeHeuristic: {
            type: "boolean",
            description: "是否包含启发式推测（默认 true）",
            default: true,
          },
        },
      },
    },
    async ({ includeHeuristic = true }) => {
      const subnets = await discoverSubnets({ includeHeuristic });
      return {
        content: [{ type: "text", text: JSON.stringify(subnets, null, 2) }],
      };
    },
  );

  server.registerTool(
    "discover_hosts",
    {
      title: "主机发现",
      description: "对指定网段执行 ARP + ICMP 主机发现，返回存活主机列表。",
      inputSchema: {
        type: "object",
        properties: {
          subnet: { type: "string", description: "目标网段 (CIDR)，如 192.168.1.0/24" },
        },
        required: ["subnet"],
      },
    },
    async ({ subnet }) => {
      const hosts = await discoverHosts(subnet);
      return {
        content: [{ type: "text", text: JSON.stringify(hosts, null, 2) }],
      };
    },
  );

  server.registerTool(
    "scan_host",
    {
      title: "深度主机扫描",
      description: "对指定 IP 执行端口扫描、服务识别和 OS 探测。",
      inputSchema: {
        type: "object",
        properties: {
          ip: { type: "string", description: "目标 IP 地址" },
          ports: { type: "string", description: "端口范围 (nmap 格式)，默认 1-1000", default: "1-1000" },
        },
        required: ["ip"],
      },
    },
    async ({ ip, ports = "1-1000" }) => {
      const result = await scanHost(ip, { portRange: ports });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "trace_route",
    {
      title: "路由追踪",
      description: "对目标 IP 执行 traceroute，返回路径跳点列表。",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "目标 IP 地址" },
        },
        required: ["target"],
      },
    },
    async ({ target }) => {
      const hops = await traceRoute(target);
      return {
        content: [{ type: "text", text: JSON.stringify(hops, null, 2) }],
      };
    },
  );

  server.registerTool(
    "build_topology",
    {
      title: "构建拓扑图",
      description: "综合已收集的扫描数据，构建网络拓扑图（节点 + 边）。",
      inputSchema: {
        type: "object",
        properties: {
          hosts: { type: "array", items: { type: "object" }, description: "discover_hosts 的输出" },
          hostDetails: { type: "array", items: { type: "object" }, description: "scan_host 的输出数组" },
          traces: { type: "array", items: { type: "object" }, description: "trace_route 的输出数组" },
        },
        required: ["hosts"],
      },
    },
    async ({ hosts, hostDetails = [], traces = [] }) => {
      const topology = buildTopology({ hosts, hostDetails, traces });
      return {
        content: [{ type: "text", text: JSON.stringify(topology, null, 2) }],
      };
    },
  );

  server.registerTool(
    "full_scan",
    {
      title: "一键全扫描",
      description: "自动执行完整的拓扑发现流程：网段识别 → 主机发现 → 端口扫描 → 路由追踪 → 拓扑构建。扫描完成后请在右侧面板打开 UI 查看拓扑图。",
      inputSchema: {
        type: "object",
        properties: {
          startSubnet: {
            type: "string",
            description: "起始网段 (CIDR)。留空则自动识别。",
          },
        },
      },
    },
    async ({ startSubnet }) => {
      const scanId = `scan_${Date.now()}`;
      const state = {
        scanId,
        status: "running",
        phase: "subnet_detect",
        phases: [
          { name: "subnet_detect", total: 1, done: 0, status: "pending" },
          { name: "host_discovery", total: 0, done: 0, status: "pending" },
          { name: "port_scan", total: 0, done: 0, status: "pending" },
          { name: "topology_build", total: 1, done: 0, status: "pending" },
        ],
        intermediate: { hostsFound: 0, routersFound: 0, switchesFound: 0, edgesFound: 0 },
      };
      setScanState(state);

      // Phase 1: Subnet discovery
      state.phases[0].status = "running";
      const subnets = startSubnet
        ? [{ subnet: startSubnet, source: "user", gateway: null }]
        : await discoverSubnets({ includeHeuristic: true });
      state.phases[0].done = 1;
      state.phases[0].status = "done";

      // Phase 2: Host discovery
      state.phase = "host_discovery";
      state.phases[1].total = subnets.length;
      state.phases[1].status = "running";
      let allHosts = [];
      for (let i = 0; i < subnets.length; i++) {
        const s = subnets[i];
        const hosts = await discoverHosts(s.subnet);
        allHosts = allHosts.concat(hosts.map(h => ({ ...h, subnet: s.subnet })));
        state.phases[1].done = i + 1;
        state.intermediate.hostsFound = allHosts.length;
      }
      state.phases[1].status = "done";

      // Phase 3: Port scan (limit to first 50 hosts for MVP responsiveness)
      state.phase = "port_scan";
      const scanTargets = allHosts.slice(0, 50);
      state.phases[2].total = scanTargets.length;
      state.phases[2].status = "running";
      let hostDetails = [];
      for (let i = 0; i < scanTargets.length; i++) {
        const h = scanTargets[i];
        try {
          const detail = await scanHost(h.ip, { portRange: "1-1000" });
          hostDetails.push(detail);
        } catch { /* skip dead hosts */ }
        state.phases[2].done = i + 1;
      }
      state.phases[2].status = "done";

      // Phase 4: Topology build
      state.phase = "topology_build";
      state.phases[3].status = "running";
      const topology = buildTopology({ hosts: allHosts, hostDetails, traces: [] });
      state.phases[3].done = 1;
      state.phases[3].status = "done";
      state.status = "done";
      state.topology = topology;

      return {
        content: [{
          type: "text",
          text: `扫描完成！共发现 ${topology.statistics.hostsFound} 台主机。\n\n📊 [查看拓扑图](${makeTopologyUrl(scanId)})`,
        }],
      };
    },
  );
}
```

- [ ] **Step 3: Write server.js**

```js
// server.js
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./src/mcp/tools.js";
import { registerPrompts } from "./src/mcp/prompts.js";

const app = express();
app.use(express.json());

// In-memory scan state store (per-session)
const scanStates = new Map();
const getScanState = (id) => scanStates.get(id);
const setScanState = (state) => { scanStates.set(state.scanId, state); };

// API: scan progress
app.get("/api/progress/:scanId", (req, res) => {
  const state = scanStates.get(req.params.scanId);
  if (!state) return res.status(404).json({ error: "scan not found" });
  res.json(state);
});

// API: cancel scan
app.put("/api/scan/cancel", (req, res) => {
  const { scanId } = req.body;
  const state = scanStates.get(scanId);
  if (state) { state.status = "cancelled"; state._abort = true; }
  res.json({ cancelled: true });
});

// API: topology data for UI
app.get("/api/topology/:scanId", (req, res) => {
  const state = scanStates.get(req.params.scanId);
  if (!state || !state.topology) return res.status(404).json({ error: "topology not ready" });
  res.json(state.topology);
});

// Static UI
app.use("/ui", express.static("src/ui"));

const server = new McpServer({
  name: "@aipy-pro/net-topology",
  version: "1.0.0",
});

registerTools(server, { getScanState, setScanState });
registerPrompts(server);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
await server.connect(transport);
app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

const listener = app.listen(0, () => {
  console.log(`MCP server listening on port ${listener.address().port}`);
});
```

- [ ] **Step 4: Verify server starts**

```bash
cd @aipy-pro/net-topology && timeout 3 node server.js || true
```
Expected: prints `MCP server listening on port <N>` then exits on timeout.

- [ ] **Step 5: Commit**

```bash
git add @aipy-pro/net-topology/server.js @aipy-pro/net-topology/src/mcp/
git commit -m "feat: server entry point with MCP transport and tool skeletons"
```

---

### Task 3: Rate Limiter

**Files:**
- Create: `@aipy-pro/net-topology/src/scanner/rate-limiter.js`

**Produces:** `RateLimiter` class — `acquire()`, `throttle()`, adaptive backoff.
**Consumed by:** all scanner modules.

- [ ] **Step 1: Write rate-limiter.js**

```js
// src/scanner/rate-limiter.js

const DEFAULTS = {
  maxConcurrent: 20,
  arpIntervalMs: 50,
  icmpIntervalMs: 100,
  tcpPps: 50,
  perHostMaxPortsPerSec: 100,
  perHostMaxConcurrent: 10,
  backoffThreshold: 0.3,   // 30% loss → throttle
  backoffFactor: 0.5,       // reduce rate by 50%
  maxRetries: 2,
};

export class RateLimiter {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this._running = 0;
    this._queue = [];
    this._tokens = this.opts.tcpPps;
    this._lastRefill = Date.now();
    this._consecutiveFailures = 0;
  }

  // Acquire a slot — resolves when ready to send
  async acquire(type = "tcp") {
    while (this._running >= this.opts.maxConcurrent) {
      await sleep(10);
    }
    const interval = type === "arp" ? this.opts.arpIntervalMs
      : type === "icmp" ? this.opts.icmpIntervalMs
      : 1000 / this.opts.tcpPps;
    await sleep(interval);
    this._running++;
    return () => { this._running--; }; // release function
  }

  // Report result for adaptive backoff
  report(success) {
    if (!success) {
      this._consecutiveFailures++;
    } else {
      this._consecutiveFailures = Math.max(0, this._consecutiveFailures - 1);
    }
  }

  get throttleFactor() {
    if (this._consecutiveFailures >= 5) return this.opts.backoffFactor;
    if (this._consecutiveFailures >= 3) return this.opts.backoffFactor;
    return 1.0;
  }

  get currentRate() {
    return Math.floor(this.opts.tcpPps * this.throttleFactor);
  }

  get retries() {
    return this._consecutiveFailures >= 5 ? 1 : this.opts.maxRetries;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
```

- [ ] **Step 2: Commit**

```bash
git add @aipy-pro/net-topology/src/scanner/rate-limiter.js
git commit -m "feat: rate limiter with adaptive backoff"
```

---

### Task 4: Subnet Discovery

**Files:**
- Create: `@aipy-pro/net-topology/src/scanner/subnet-discovery.js`
- Create: `@aipy-pro/net-topology/test/scanner/subnet-discovery.test.js`

**Produces:** `discoverSubnets({ includeHeuristic })` → `[{ subnet, source, gateway }]`
**Dependencies:** Node.js `child_process` (route/arp commands), `os` (network interfaces)

- [ ] **Step 1: Write failing test**

```js
// test/scanner/subnet-discovery.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { discoverSubnets } from "../../src/scanner/subnet-discovery.js";

describe("discoverSubnets", () => {
  it("returns array of subnet objects", async () => {
    const subnets = await discoverSubnets({ includeHeuristic: false });
    assert.ok(Array.isArray(subnets));
    for (const s of subnets) {
      assert.ok(typeof s.subnet === "string");
      assert.ok(typeof s.source === "string");
      assert.ok(["route_table", "arp_cache", "heuristic"].includes(s.source));
    }
  });

  it("each subnet has valid CIDR format", async () => {
    const subnets = await discoverSubnets({ includeHeuristic: true });
    for (const s of subnets) {
      assert.match(s.subnet, /^\d+\.\d+\.\d+\.\d+\/\d+$/);
    }
  });

  it("excludes default route 0.0.0.0", async () => {
    const subnets = await discoverSubnets({ includeHeuristic: false });
    const hasDefault = subnets.some(s => s.subnet.startsWith("0."));
    assert.equal(hasDefault, false, "should not include default route");
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
node --test test/scanner/subnet-discovery.test.js
```

- [ ] **Step 3: Write implementation**

```js
// src/scanner/subnet-discovery.js
import { execSync } from "child_process";
import os from "os";

// RFC 1918 private address ranges
const PRIVATE_RANGES = [
  { network: [10, 0, 0, 0], prefix: 8 },
  { network: [172, 16, 0, 0], prefix: 12 },
  { network: [192, 168, 0, 0], prefix: 16 },
];

function ipToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
}

function isPrivate(ip) {
  const int = ipToInt(ip);
  for (const range of PRIVATE_RANGES) {
    const netInt = range.network.reduce((a, o) => (a << 8) + o, 0) >>> 0;
    const mask = (~0) << (32 - range.prefix);
    if ((int & mask) === (netInt & mask)) return true;
  }
  return false;
}

// Method 1: Read routing table
function discoverFromRouteTable() {
  const subnets = [];
  try {
    const isWindows = process.platform === "win32";
    let output;
    if (isWindows) {
      output = execSync("route print", { encoding: "utf8", timeout: 5000 });
    } else {
      output = execSync("ip route show 2>/dev/null || route -n", { encoding: "utf8", timeout: 5000, shell: true });
    }
    const lines = output.split("\n");
    for (const line of lines) {
      // Match CIDR patterns like "192.168.1.0/24" or "10.0.0.0/8"
      const m = line.match(/(\d+\.\d+\.\d+\.\d+\/\d+)/);
      if (m) {
        const cidr = m[1];
        const [ip] = cidr.split("/");
        // Exclude default route and public IPs
        if (cidr.startsWith("0.0.0.0")) continue;
        if (cidr === "127.0.0.0/8") continue;
        if (isPrivate(ip)) {
          const gatewayMatch = line.match(/via\s+(\d+\.\d+\.\d+\.\d+)/);
          subnets.push({
            subnet: cidr,
            source: "route_table",
            gateway: gatewayMatch ? gatewayMatch[1] : null,
          });
        }
      }
    }
  } catch { /* route command unavailable */ }
  return subnets;
}

// Method 2: ARP cache cross-subnet extraction
function discoverFromArpCache() {
  const subnets = [];
  try {
    const isWindows = process.platform === "win32";
    const output = execSync(isWindows ? "arp -a" : "arp -a -n 2>/dev/null || arp -a", {
      encoding: "utf8", timeout: 5000, shell: true,
    });
    const ips = output.match(/\d+\.\d+\.\d+\.\d+/g) || [];
    const uniqueSubnets = new Set();
    for (const ip of ips) {
      if (!isPrivate(ip)) continue;
      const parts = ip.split(".").map(Number);
      const subnet24 = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      if (!uniqueSubnets.has(subnet24)) {
        uniqueSubnets.add(subnet24);
        subnets.push({ subnet: subnet24, source: "arp_cache", gateway: null });
      }
    }
  } catch { /* arp unavailable */ }
  return subnets;
}

// Method 3: Heuristic — probe common /24 gateways on private ranges
async function discoverHeuristic() {
  const subnets = [];
  // Common private /24 prefixes
  const templates = [];
  for (let i = 0; i <= 10; i++) templates.push(`192.168.${i}.0/24`);
  for (let i = 0; i <= 10; i++) templates.push(`10.0.${i}.0/24`);
  for (let i = 0; i <= 5; i++) templates.push(`10.10.${i}.0/24`);
  templates.push("172.16.0.0/24", "172.16.1.0/24");

  // Probing omitted in MVP — return templates as candidates marked heuristic
  for (const t of templates) {
    subnets.push({ subnet: t, source: "heuristic", gateway: null });
  }
  return subnets;
}

export async function discoverSubnets({ includeHeuristic = true } = {}) {
  let all = [];
  // Method 1: Route table (always)
  const fromRoute = discoverFromRouteTable();
  all = all.concat(fromRoute);

  // Method 2: ARP cache (always)
  const fromArp = discoverFromArpCache();
  all = all.concat(fromArp);

  // Method 3: Heuristic (optional)
  if (includeHeuristic) {
    const fromHeuristic = await discoverHeuristic();
    all = all.concat(fromHeuristic);
  }

  // Deduplicate by subnet
  const seen = new Set();
  const result = [];
  for (const s of all) {
    if (!seen.has(s.subnet)) {
      seen.add(s.subnet);
      result.push(s);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test — expected PASS**

```bash
node --test test/scanner/subnet-discovery.test.js
```

- [ ] **Step 5: Commit**

```bash
git add @aipy-pro/net-topology/src/scanner/subnet-discovery.js @aipy-pro/net-topology/test/
git commit -m "feat: subnet discovery from route table, ARP cache, and heuristics"
```

---

### Task 5: Host Discovery

**Files:**
- Create: `@aipy-pro/net-topology/src/scanner/host-discovery.js`
- Create: `@aipy-pro/net-topology/test/scanner/host-discovery.test.js`

**Produces:** `discoverHosts(subnet)` → `[{ ip, mac, vendor, isGateway }]`
**Consumes:** RateLimiter from Task 3

- [ ] **Step 1: Write failing test**

```js
// test/scanner/host-discovery.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { discoverHosts } from "../../src/scanner/host-discovery.js";

describe("discoverHosts", () => {
  it("returns array of host objects for a valid subnet", async () => {
    const hosts = await discoverHosts("127.0.0.1/32");
    assert.ok(Array.isArray(hosts));
  });

  it("each host has required fields", async () => {
    const hosts = await discoverHosts("127.0.0.1/32");
    for (const h of hosts) {
      assert.ok(typeof h.ip === "string");
      // mac may be null if not available
      assert.ok(typeof h.status === "string");
      assert.ok(["up", "down"].includes(h.status));
    }
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
node --test test/scanner/host-discovery.test.js
```

- [ ] **Step 3: Write implementation**

```js
// src/scanner/host-discovery.js
import { execSync, exec } from "child_process";
import { promisify } from "util";
import { RateLimiter } from "./rate-limiter.js";

const execP = promisify(exec);

// OUI lookup — lightweight embedded subset for common vendors
const OUI_MAP = {
  "00000c": "Cisco Systems",
  "001a30": "Juniper Networks",
  "00095b": "Netgear",
  "001b17": "Palo Alto Networks",
  "00090f": "Fortinet",
  "001c7e": "Check Point",
  "0050ba": "D-Link",
  "0017a4": "Hewlett Packard",
  "3c8c40": "Huawei Technologies",
  "74882a": "H3C Technologies",
};

function lookupOUI(mac) {
  if (!mac) return null;
  const prefix = mac.replace(/[:\-]/g, "").substring(0, 6).toLowerCase();
  return OUI_MAP[prefix] || null;
}

// ICMP ping check — fast single-host probe
async function pingHost(ip) {
  try {
    const isWindows = process.platform === "win32";
    const cmd = isWindows
      ? `ping -n 1 -w 500 ${ip}`
      : `ping -c 1 -W 1 ${ip}`;
    await execP(cmd, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// ARP scan for a subnet
async function arpScan(subnet) {
  const hosts = [];
  try {
    const isWindows = process.platform === "win32";
    let output;
    if (isWindows) {
      output = execSync(`arp -a`, { encoding: "utf8", timeout: 10000 });
    } else {
      // Try arp-scan first, fall back to arp -a
      try {
        output = execSync(`arp-scan --localnet 2>/dev/null || arp -a -n`, {
          encoding: "utf8", timeout: 15000, shell: true,
        });
      } catch {
        output = execSync(`arp -a -n 2>/dev/null || arp -a`, {
          encoding: "utf8", timeout: 10000, shell: true,
        });
      }
    }
    const lines = output.split("\n");
    for (const line of lines) {
      // Match IP and MAC patterns
      const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+)/);
      const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
      if (ipMatch) {
        const ip = ipMatch[1];
        const mac = macMatch ? macMatch[0].toLowerCase() : null;
        // Filter to target subnet
        if (isIpInSubnet(ip, subnet)) {
          hosts.push({
            ip,
            mac,
            vendor: lookupOUI(mac),
            status: "up",
            isGateway: false,
          });
        }
      }
    }
  } catch { /* arp unavailable, fall through to ICMP */ }
  return hosts;
}

function isIpInSubnet(ip, cidr) {
  const [net, prefix] = cidr.split("/");
  const p = parseInt(prefix);
  const ipInt = ip.split(".").reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0;
  const netInt = net.split(".").reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0;
  const mask = (~0) << (32 - p);
  return (ipInt & mask) === (netInt & mask);
}

function* subnetIps(cidr) {
  const [net, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr);
  if (prefix > 30) {
    // Single host or point-to-point — yield network address
    yield net;
    return;
  }
  const netParts = net.split(".").map(Number);
  const netInt = netParts.reduce((a, o) => (a << 8) + o, 0) >>> 0;
  const mask = (~0) << (32 - prefix);
  const start = (netInt & mask) >>> 0;
  const count = 1 << (32 - prefix);
  // Limit to 256 hosts for MVP (subnet too large → sample)
  const maxHosts = Math.min(count - 2, 256);
  for (let i = 1; i <= maxHosts; i++) {
    const ipInt = start + i;
    yield `${(ipInt >> 24) & 0xff}.${(ipInt >> 16) & 0xff}.${(ipInt >> 8) & 0xff}.${ipInt & 0xff}`;
  }
}

export async function discoverHosts(subnet, opts = {}) {
  const limiter = new RateLimiter(opts);
  const hosts = [];
  const hostsByIp = new Map();

  // Phase A: ARP scan (fast, gets MAC)
  try {
    const arpHosts = await arpScan(subnet);
    for (const h of arpHosts) {
      hostsByIp.set(h.ip, h);
    }
  } catch { /* continue with ICMP */ }

  // Phase B: ICMP sweep for IPs not found via ARP
  const ips = Array.from(subnetIps(subnet));
  const promises = ips.map(async (ip) => {
    if (hostsByIp.has(ip)) return;
    const release = await limiter.acquire("icmp");
    try {
      const alive = await pingHost(ip);
      limiter.report(alive);
      if (alive) {
        hostsByIp.set(ip, { ip, mac: null, vendor: null, status: "up", isGateway: false });
      }
    } finally {
      release();
    }
  });
  await Promise.all(promises);

  // Detect gateway: .1 address in /24 subnet
  const [net] = subnet.split("/");
  const netParts = net.split(".").map(Number);
  const gatewayIp = `${netParts[0]}.${netParts[1]}.${netParts[2]}.1`;

  return Array.from(hostsByIp.values()).map(h => ({
    ...h,
    isGateway: h.ip === gatewayIp,
  }));
}
```

- [ ] **Step 4: Run test — expected PASS**

```bash
node --test test/scanner/host-discovery.test.js
```

- [ ] **Step 5: Commit**

```bash
git add @aipy-pro/net-topology/src/scanner/host-discovery.js @aipy-pro/net-topology/test/scanner/host-discovery.test.js
git commit -m "feat: host discovery via ARP scan and ICMP ping sweep"
```

---

### Task 6: Port Scanner

**Files:**
- Create: `@aipy-pro/net-topology/src/scanner/port-scanner.js`
- Create: `@aipy-pro/net-topology/test/scanner/port-scanner.test.js`

**Produces:** `scanHost(ip, { portRange })` → `{ ip, mac, hostname, os, ports: [{ port, service, version }] }`
**Consumes:** RateLimiter from Task 3

- [ ] **Step 1: Write failing test**

```js
// test/scanner/port-scanner.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { scanHost } from "../../src/scanner/port-scanner.js";

describe("scanHost", () => {
  it("returns host scan result with ports array", async () => {
    const result = await scanHost("127.0.0.1", { portRange: "22" });
    assert.ok(typeof result.ip === "string");
    assert.ok(Array.isArray(result.ports));
  });

  it("detects nmap availability", async () => {
    // Will fall back to native if nmap not available
    const result = await scanHost("127.0.0.1", { portRange: "80" });
    assert.ok(result.scanMethod === "nmap" || result.scanMethod === "native");
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
node --test test/scanner/port-scanner.test.js
```

- [ ] **Step 3: Write implementation**

```js
// src/scanner/port-scanner.js
import { execSync, exec } from "child_process";
import { promisify } from "util";
import net from "net";
import { RateLimiter } from "./rate-limiter.js";

const execP = promisify(exec);

// Well-known port → service mapping
const WELL_KNOWN = {
  21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
  80: "http", 110: "pop3", 143: "imap", 161: "snmp", 179: "bgp",
  389: "ldap", 443: "https", 445: "smb", 465: "smtps", 514: "syslog",
  520: "rip", 587: "smtp", 636: "ldaps", 993: "imaps", 995: "pop3s",
  1433: "mssql", 1521: "oracle", 3306: "mysql", 3389: "rdp",
  5432: "postgresql", 6379: "redis", 8080: "http-proxy", 8443: "https-alt",
  9090: "websphere", 9200: "elasticsearch", 27017: "mongodb",
};

// Check if nmap is available
function hasNmap() {
  try {
    execSync("nmap --version", { encoding: "utf8", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// Nmap-based scan (preferred)
async function scanWithNmap(ip, portRange) {
  try {
    const cmd = `nmap -sS -sV -O -p ${portRange} --host-timeout 30s -T4 -oX - ${ip}`;
    const { stdout } = await execP(cmd, { timeout: 60000 });
    return parseNmapXml(stdout);
  } catch (err) {
    throw new Error(`nmap scan failed: ${err.message}`);
  }
}

// Minimal nmap XML parser
function parseNmapXml(xml) {
  const result = { ip: "", mac: null, hostname: "", os: "", ports: [], scanMethod: "nmap" };
  const addrMatch = xml.match(/<address addr="([^"]+)" addrtype="ipv4"/);
  if (addrMatch) result.ip = addrMatch[1];
  const macMatch = xml.match(/<address addr="([^"]+)" addrtype="mac"/);
  if (macMatch) result.mac = macMatch[1].toLowerCase();
  const hostMatch = xml.match(/<hostname name="([^"]+)"/);
  if (hostMatch) result.hostname = hostMatch[1];
  const osMatch = xml.match(/<osmatch name="([^"]+)" accuracy="(\d+)"/);
  if (osMatch) result.os = osMatch[1];

  const portRegex = /<port protocol="tcp" portid="(\d+)">[\s\S]*?<state state="(\w+)"[\s\S]*?<service name="([^"]*)"(?:\s+product="([^"]*)")?(?:\s+version="([^"]*)")?/g;
  let m;
  while ((m = portRegex.exec(xml)) !== null) {
    if (m[2] === "open") {
      result.ports.push({
        port: parseInt(m[1]),
        service: m[3] || "unknown",
        version: m[5] || m[4] || null,
      });
    }
  }
  return result;
}

// Native Node.js TCP connect scan (fallback)
async function scanNative(ip, portRange) {
  const result = { ip, mac: null, hostname: "", os: "", ports: [], scanMethod: "native" };
  const [start, end] = portRange.split("-").map(Number);
  const endPort = end || start;
  const limiter = new RateLimiter();

  const promises = [];
  for (let port = start; port <= endPort; port++) {
    promises.push((async () => {
      const release = await limiter.acquire("tcp");
      try {
        const open = await checkPort(ip, port);
        if (open) {
          result.ports.push({
            port,
            service: WELL_KNOWN[port] || "unknown",
            version: null,
          });
        }
      } finally {
        release();
      }
    })());
  }
  await Promise.all(promises);
  result.ports.sort((a, b) => a.port - b.port);
  return result;
}

function checkPort(ip, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, ip);
  });
}

export async function scanHost(ip, opts = {}) {
  const { portRange = "1-1000" } = opts;

  if (hasNmap()) {
    try {
      return await scanWithNmap(ip, portRange);
    } catch {
      // Nmap failed, fall through to native
    }
  }

  return await scanNative(ip, portRange);
}
```

- [ ] **Step 4: Run test — expected PASS**

```bash
node --test test/scanner/port-scanner.test.js
```

- [ ] **Step 5: Commit**

```bash
git add @aipy-pro/net-topology/src/scanner/port-scanner.js @aipy-pro/net-topology/test/scanner/port-scanner.test.js
git commit -m "feat: port scanner with nmap and native TCP connect fallback"
```

---

### Task 7: Traceroute

**Files:**
- Create: `@aipy-pro/net-topology/src/scanner/traceroute.js`
- Create: `@aipy-pro/net-topology/test/scanner/traceroute.test.js`

**Produces:** `traceRoute(target)` → `[{ hop, ip, rtt }]`

- [ ] **Step 1: Write failing test**

```js
// test/scanner/traceroute.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { traceRoute } from "../../src/scanner/traceroute.js";

describe("traceRoute", () => {
  it("returns array of hop objects", async () => {
    const hops = await traceRoute("127.0.0.1");
    assert.ok(Array.isArray(hops));
    for (const h of hops) {
      assert.ok(typeof h.hop === "number");
      assert.ok(typeof h.ip === "string");
    }
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
node --test test/scanner/traceroute.test.js
```

- [ ] **Step 3: Write implementation**

```js
// src/scanner/traceroute.js
import { exec } from "child_process";
import { promisify } from "util";

const execP = promisify(exec);

export async function traceRoute(target, opts = {}) {
  const { maxHops = 30, timeout = 30000 } = opts;
  const isWindows = process.platform === "win32";

  try {
    const cmd = isWindows
      ? `tracert -d -h ${maxHops} ${target}`
      : `traceroute -n -m ${maxHops} -w 1 ${target} 2>/dev/null || traceroute -n ${target}`;
    const { stdout } = await execP(cmd, { timeout, shell: true });
    return parseTraceroute(stdout, isWindows);
  } catch (err) {
    // traceroute may return non-zero even with valid output
    if (err.stdout) return parseTraceroute(err.stdout, isWindows);
    return [];
  }
}

function parseTraceroute(output, isWindows) {
  const hops = [];
  const lines = output.split("\n");
  for (const line of lines) {
    if (isWindows) {
      // Windows tracert: " 1   <1 ms   <1 ms   <1 ms  192.168.1.1"
      const m = line.match(/^\s*(\d+)\s+.+?(\d+\.\d+\.\d+\.\d+)/);
      if (m) {
        hops.push({ hop: parseInt(m[1]), ip: m[2], rtt: null });
      }
    } else {
      // Unix traceroute: " 1  192.168.1.1  1.234 ms  1.456 ms  1.678 ms"
      const m = line.match(/^\s*(\d+)\s+(\d+\.\d+\.\d+\.\d+)/);
      if (m) {
        const rttMatch = line.match(/([\d.]+)\s*ms/);
        hops.push({
          hop: parseInt(m[1]),
          ip: m[2],
          rtt: rttMatch ? parseFloat(rttMatch[1]) : null,
        });
      }
    }
  }
  return hops;
}
```

- [ ] **Step 4: Run test — expected PASS**

```bash
node --test test/scanner/traceroute.test.js
```

- [ ] **Step 5: Commit**

```bash
git add @aipy-pro/net-topology/src/scanner/traceroute.js @aipy-pro/net-topology/test/scanner/traceroute.test.js
git commit -m "feat: traceroute with Windows and Unix support"
```

---

### Task 8: Topology Builder

**Files:**
- Create: `@aipy-pro/net-topology/src/analyzer/topology-builder.js`
- Create: `@aipy-pro/net-topology/test/analyzer/topology-builder.test.js`

**Produces:** `buildTopology({ hosts, hostDetails, traces })` → topology JSON per spec §4.1
**Consumes:** host data from Tasks 5-7

- [ ] **Step 1: Write failing test**

```js
// test/analyzer/topology-builder.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildTopology } from "../../src/analyzer/topology-builder.js";

describe("buildTopology", () => {
  const sampleHosts = [
    { ip: "192.168.1.1", mac: "00:00:0c:11:22:01", status: "up", isGateway: true, subnet: "192.168.1.0/24" },
    { ip: "192.168.1.100", mac: "aa:bb:cc:dd:ee:01", status: "up", isGateway: false, subnet: "192.168.1.0/24" },
    { ip: "192.168.1.101", mac: "aa:bb:cc:dd:ee:02", status: "up", isGateway: false, subnet: "192.168.1.0/24" },
  ];

  it("returns topology with nodes and edges", () => {
    const topo = buildTopology({ hosts: sampleHosts, hostDetails: [], traces: [] });
    assert.ok(Array.isArray(topo.topology.nodes));
    assert.ok(Array.isArray(topo.topology.edges));
    assert.ok(topo.statistics);
    assert.ok(topo.scanId);
  });

  it("creates a node for each host", () => {
    const topo = buildTopology({ hosts: sampleHosts, hostDetails: [], traces: [] });
    assert.equal(topo.topology.nodes.length, 3);
  });

  it("creates edges from endpoints to gateway", () => {
    const topo = buildTopology({ hosts: sampleHosts, hostDetails: [], traces: [] });
    // 2 endpoints → 2 edges to gateway .1
    const edges = topo.topology.edges.filter(e => e.type === "l3_route");
    assert.ok(edges.length >= 2);
    assert.equal(edges[0].target, "192.168.1.1");
  });

  it("includes statistics", () => {
    const topo = buildTopology({ hosts: sampleHosts, hostDetails: [], traces: [] });
    assert.equal(topo.statistics.hostsFound, 3);
    assert.equal(topo.statistics.subnetsFound, 1);
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
node --test test/analyzer/topology-builder.test.js
```

- [ ] **Step 3: Write implementation**

```js
// src/analyzer/topology-builder.js

export function buildTopology({ hosts, hostDetails = [], traces = [] }) {
  const nodes = [];
  const edges = [];
  const subnetsSeen = new Set();

  // Build host detail lookup
  const detailByIp = new Map();
  for (const d of hostDetails) {
    if (d.ip) detailByIp.set(d.ip, d);
  }

  // Create nodes
  for (const h of hosts) {
    const detail = detailByIp.get(h.ip) || {};
    const node = {
      id: h.ip,
      mac: h.mac || detail.mac || null,
      type: h.isGateway ? "gateway" : "endpoint",
      roleConfidence: h.isGateway ? 0.7 : 1.0,
      hostname: detail.hostname || "",
      os: detail.os || "",
      vendor: h.vendor || null,
      ports: detail.ports || [],
      layer: h.isGateway ? 3 : 2,
      subnet: h.subnet || guessSubnet(h.ip),
      isGateway: h.isGateway,
    };
    nodes.push(node);
    if (h.subnet) subnetsSeen.add(h.subnet);
  }

  // Find gateway IP(s)
  const gateways = nodes.filter(n => n.isGateway);
  const endpoints = nodes.filter(n => !n.isGateway);

  // Create edges: each endpoint → its subnet's gateway
  const subnetGateway = new Map();
  for (const g of gateways) {
    if (g.subnet) subnetGateway.set(g.subnet, g.id);
  }

  for (const ep of endpoints) {
    const gw = subnetGateway.get(ep.subnet);
    if (gw && gw !== ep.id) {
      edges.push({
        source: ep.id,
        target: gw,
        type: "l3_route",
        confidence: 0.9,
        method: "subnet_gateway",
        label: "subnet route",
      });
    }
  }

  // Create edges from traceroute data
  for (const trace of traces) {
    if (!trace.hops || trace.hops.length < 2) continue;
    for (let i = 0; i < trace.hops.length - 1; i++) {
      edges.push({
        source: trace.hops[i].ip,
        target: trace.hops[i + 1].ip,
        type: "l3_route",
        confidence: 0.85,
        method: "traceroute",
        label: `hop ${trace.hops[i].hop}→${trace.hops[i + 1].hop}`,
      });
    }
  }

  // Deduplicate edges
  const edgeSet = new Set();
  const uniqueEdges = [];
  for (const e of edges) {
    const key = `${e.source}→${e.target}::${e.type}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      uniqueEdges.push(e);
    }
  }

  const scanId = `scan_${Date.now()}`;
  return {
    scanId,
    createdAt: new Date().toISOString(),
    subnetsScanned: Array.from(subnetsSeen),
    topology: {
      nodes,
      edges: uniqueEdges,
    },
    boundaries: [],
    statistics: {
      hostsFound: nodes.length,
      routers: gateways.length,
      switches: 0,
      firewalls: 0,
      endpoints: endpoints.length,
      edgesFound: uniqueEdges.length,
      subnetsFound: subnetsSeen.size,
      scanDurationMs: 0,
    },
  };
}

function guessSubnet(ip) {
  const parts = ip.split(".").map(Number);
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}
```

- [ ] **Step 4: Run test — expected PASS**

```bash
node --test test/analyzer/topology-builder.test.js
```

- [ ] **Step 5: Commit**

```bash
git add @aipy-pro/net-topology/src/analyzer/topology-builder.js @aipy-pro/net-topology/test/analyzer/
git commit -m "feat: topology builder — nodes, edges from hosts and traceroutes"
```

---

### Task 9: Web UI — Topology Visualization

**Files:**
- Create: `@aipy-pro/net-topology/src/ui/index.html`
- Create: `@aipy-pro/net-topology/src/ui/app.js`
- Create: `@aipy-pro/net-topology/src/ui/styles.css`

**Produces:** Interactive Cytoscape.js topology graph served at `/ui`

- [ ] **Step 1: Write index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NetTopology</title>
  <link rel="stylesheet" href="styles.css">
  <script src="https://unpkg.com/cytoscape@3.30.0/dist/cytoscape.min.js"></script>
</head>
<body>
  <div id="app">
    <header id="toolbar">
      <h1>NetTopology</h1>
      <div id="scan-info">
        <span id="scan-status">等待扫描...</span>
        <span id="scan-stats"></span>
      </div>
      <div id="controls">
        <select id="layout-select">
          <option value="cose">力导向</option>
          <option value="circle">环形</option>
          <option value="breadthfirst">树形</option>
          <option value="grid">网格</option>
        </select>
        <button id="btn-fit">适应窗口</button>
        <button id="btn-export-png">导出 PNG</button>
      </div>
    </header>
    <main>
      <div id="cy-container"></div>
      <aside id="detail-panel" class="hidden">
        <h3 id="detail-title"></h3>
        <button id="btn-close-detail">✕</button>
        <div id="detail-content"></div>
      </aside>
    </main>
    <footer id="legend">
      <span class="legend-item"><span class="dot router"></span> 网关/路由器</span>
      <span class="legend-item"><span class="dot switch"></span> 交换机</span>
      <span class="legend-item"><span class="dot endpoint"></span> 终端</span>
      <span class="legend-item"><span class="dot unknown"></span> 未知</span>
    </footer>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write styles.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1d23; color: #e0e0e0; height: 100vh; overflow: hidden; }
#app { display: flex; flex-direction: column; height: 100vh; }
#toolbar { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: #252830; border-bottom: 1px solid #333; }
#toolbar h1 { font-size: 16px; color: #1a73e8; white-space: nowrap; }
#scan-info { display: flex; gap: 12px; font-size: 12px; color: #888; flex: 1; }
#scan-stats { color: #5a9; }
#controls { display: flex; gap: 8px; }
#controls select, #controls button { padding: 4px 10px; font-size: 12px; background: #333; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; cursor: pointer; }
#controls button:hover { background: #444; }
main { display: flex; flex: 1; overflow: hidden; }
#cy-container { flex: 1; }
#detail-panel { width: 300px; background: #252830; border-left: 1px solid #333; padding: 16px; overflow-y: auto; position: relative; }
#detail-panel.hidden { display: none; }
#detail-title { font-size: 14px; margin-bottom: 12px; }
#btn-close-detail { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #888; font-size: 18px; cursor: pointer; }
.detail-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; border-bottom: 1px solid #333; }
.detail-label { color: #888; }
.detail-value { color: #e0e0e0; font-family: monospace; }
#legend { display: flex; gap: 16px; padding: 6px 16px; background: #252830; border-top: 1px solid #333; font-size: 11px; }
.legend-item { display: flex; align-items: center; gap: 4px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot.router { background: #e8710a; }
.dot.switch { background: #1a73e8; }
.dot.endpoint { background: #34a853; }
.dot.unknown { background: #888; }
```

- [ ] **Step 3: Write app.js**

```js
// src/ui/app.js
const scanId = new URLSearchParams(location.search).get("scanId");

// Cytoscape initialization
const cy = cytoscape({
  container: document.getElementById("cy-container"),
  style: [
    {
      selector: "node",
      style: {
        "background-color": "#34a853",
        "label": "data(label)",
        "color": "#e0e0e0",
        "font-size": "10px",
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 6,
        "width": 24,
        "height": 24,
        "border-width": 2,
        "border-color": "#1a1d23",
      },
    },
    {
      selector: 'node[type="gateway"]',
      style: { "background-color": "#e8710a", width: 32, height: 32, "font-size": "11px" },
    },
    {
      selector: 'node[type="switch"]',
      style: { "background-color": "#1a73e8", width: 28, height: 28 },
    },
    {
      selector: "edge",
      style: {
        "width": 1.5,
        "line-color": "#555",
        "target-arrow-color": "#555",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "label": "data(label)",
        "font-size": "8px",
        "color": "#666",
      },
    },
    {
      selector: 'edge[type="l3_route"]',
      style: { "line-color": "#e8710a", "target-arrow-color": "#e8710a", "width": 2 },
    },
  ],
  layout: { name: "cose", animate: true, nodeRepulsion: () => 8000, idealEdgeLength: () => 120 },
});

// Layout switching
document.getElementById("layout-select").addEventListener("change", (e) => {
  cy.layout({ name: e.target.value, animate: true }).run();
});
document.getElementById("btn-fit").addEventListener("click", () => cy.fit(undefined, 50));

// PNG export
document.getElementById("btn-export-png").addEventListener("click", () => {
  const dataUrl = cy.png({ full: true, bg: "#1a1d23" });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `topology-${scanId || "export"}.png`;
  a.click();
});

// Node click → detail panel
const detailPanel = document.getElementById("detail-panel");
const detailContent = document.getElementById("detail-content");
const detailTitle = document.getElementById("detail-title");

cy.on("tap", "node", (evt) => {
  const node = evt.target;
  const data = node.data();
  detailPanel.classList.remove("hidden");
  detailTitle.textContent = data.label || data.id;
  detailContent.innerHTML = `
    <div class="detail-row"><span class="detail-label">IP</span><span class="detail-value">${data.id}</span></div>
    <div class="detail-row"><span class="detail-label">MAC</span><span class="detail-value">${data.mac || "N/A"}</span></div>
    <div class="detail-row"><span class="detail-label">类型</span><span class="detail-value">${data.type || "unknown"}</span></div>
    <div class="detail-row"><span class="detail-label">OS</span><span class="detail-value">${data.os || "N/A"}</span></div>
    <div class="detail-row"><span class="detail-label">厂商</span><span class="detail-value">${data.vendor || "N/A"}</span></div>
    <div class="detail-row"><span class="detail-label">主机名</span><span class="detail-value">${data.hostname || "N/A"}</span></div>
    <div class="detail-row"><span class="detail-label">开放端口</span><span class="detail-value">${(data.ports || []).map(p => p.port + "/" + p.service).join(", ") || "N/A"}</span></div>
  `;
});

cy.on("tap", (evt) => {
  if (evt.target === cy) {
    detailPanel.classList.add("hidden");
  }
});

document.getElementById("btn-close-detail").addEventListener("click", () => {
  detailPanel.classList.add("hidden");
});

// Load topology data
async function loadTopology() {
  if (!scanId) {
    document.getElementById("scan-status").textContent = "无扫描 ID — 请从 full_scan 启动";
    return;
  }
  document.getElementById("scan-status").textContent = "加载中...";

  const poll = async () => {
    try {
      const resp = await fetch(`/api/topology/${scanId}`);
      if (!resp.ok) { setTimeout(poll, 2000); return; }
      const data = await resp.json();
      renderTopology(data);
    } catch { setTimeout(poll, 2000); }
  };
  poll();
}

function renderTopology(data) {
  const elements = [];
  for (const node of data.topology.nodes) {
    elements.push({
      group: "nodes",
      data: {
        id: node.id,
        label: node.hostname || node.id,
        type: node.type,
        mac: node.mac,
        os: node.os,
        vendor: node.vendor,
        hostname: node.hostname,
        ports: node.ports,
        subnet: node.subnet,
      },
    });
  }
  for (const edge of data.topology.edges) {
    elements.push({
      group: "edges",
      data: {
        id: `${edge.source}_${edge.target}_${edge.type}`,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        label: edge.label || "",
        confidence: edge.confidence,
      },
    });
  }
  cy.json({ elements });
  cy.layout({ name: "cose", animate: true }).run();
  cy.fit(undefined, 80);

  const stats = data.statistics || {};
  document.getElementById("scan-status").textContent = "扫描完成";
  document.getElementById("scan-stats").textContent =
    `${stats.hostsFound} 主机 · ${stats.routers || 0} 路由 · ${stats.switches || 0} 交换 · ${stats.edgesFound} 连接`;
}

// Start loading
loadTopology();
```

- [ ] **Step 4: Verify UI loads in browser**

```bash
cd @aipy-pro/net-topology && node -e "
import('./server.js').catch(() => {});
setTimeout(() => process.exit(0), 2000);
" 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add @aipy-pro/net-topology/src/ui/
git commit -m "feat: Cytoscape.js topology visualization with detail panel and layout switching"
```

---

### Task 10: Integration Test — End-to-End full_scan

**Files:**
- Create: `@aipy-pro/net-topology/test/integration/full-scan.test.js`

**Produces:** Verifies all modules wire together correctly.

- [ ] **Step 1: Write integration test**

```js
// test/integration/full-scan.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { discoverSubnets } from "../../src/scanner/subnet-discovery.js";
import { discoverHosts } from "../../src/scanner/host-discovery.js";
import { scanHost } from "../../src/scanner/port-scanner.js";
import { buildTopology } from "../../src/analyzer/topology-builder.js";

describe("full_scan integration", () => {
  it("completes full pipeline for localhost", async () => {
    // Discover subnets
    const subnets = await discoverSubnets({ includeHeuristic: false });
    assert.ok(subnets.length > 0, "should find at least one subnet");

    // Discover hosts on first private subnet
    const privateSubnet = subnets.find(s =>
      s.subnet.startsWith("192.168.") ||
      s.subnet.startsWith("10.") ||
      s.subnet.startsWith("172.")
    );
    if (!privateSubnet) {
      console.log("Skipping — no private subnet to scan");
      return;
    }

    const hosts = await discoverHosts(privateSubnet.subnet);
    assert.ok(hosts.length > 0, `should find hosts on ${privateSubnet.subnet}`);

    // Scan first host
    if (hosts.length > 0) {
      const detail = await scanHost(hosts[0].ip, { portRange: "22,80,443" });
      assert.ok(detail.ip === hosts[0].ip);
      assert.ok(Array.isArray(detail.ports));
    }

    // Build topology
    const topology = buildTopology({ hosts, hostDetails: [], traces: [] });
    assert.ok(topology.topology.nodes.length > 0);
    assert.ok(topology.statistics.hostsFound > 0);
  });

  it("topology JSON matches schema", () => {
    const topology = buildTopology({
      hosts: [{ ip: "10.0.0.1", mac: "00:00:0c:aa:bb:cc", status: "up", isGateway: true, subnet: "10.0.0.0/24" }],
      hostDetails: [],
      traces: [],
    });

    // Validate schema fields
    assert.ok(typeof topology.scanId === "string");
    assert.ok(typeof topology.createdAt === "string");
    assert.ok(Array.isArray(topology.subnetsScanned));
    assert.ok(Array.isArray(topology.topology.nodes));
    assert.ok(Array.isArray(topology.topology.edges));
    assert.ok(Array.isArray(topology.boundaries));
    assert.ok(typeof topology.statistics.hostsFound === "number");
    assert.ok(typeof topology.statistics.edgesFound === "number");
  });
});
```

- [ ] **Step 2: Run test**

```bash
node --test test/integration/full-scan.test.js
```

- [ ] **Step 3: Commit**

```bash
git add @aipy-pro/net-topology/test/integration/
git commit -m "test: end-to-end full_scan integration test"
```

---

## Phase 1 Complete — Verification

After all 10 tasks complete, verify the full system:

```bash
# 1. Run all tests
cd @aipy-pro/net-topology && node --test test/**/*.test.js

# 2. Verify server starts and prints port
timeout 3 node server.js || true
# Expected: MCP server listening on port <N>

# 3. Verify manifest.json is valid
node -e "const m = JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.assert(m.keywords.includes('conversation-tool')); console.assert(m.server.type==='node'); console.log('OK')"

# 4. Verify build works
npx @anthropic-ai/dxt pack
```
