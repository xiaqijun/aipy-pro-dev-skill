import { z } from "zod";
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

export function registerTools(server, { getScanState, setScanState, credentialManager, blacklist }) {
  server.registerTool(
    "discover_subnets",
    {
      title: "发现内网网段",
      description: "从本机路由表、ARP 缓存和启发式推测中识别内网存活网段。",
      inputSchema: z.object({
        includeHeuristic: z.boolean().optional().describe("是否包含启发式推测（默认 true）"),
      }),
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
      inputSchema: z.object({
        subnet: z.string().describe("目标网段 (CIDR)，如 192.168.1.0/24"),
      }),
    },
    async ({ subnet }) => {
      const hosts = await discoverHosts(subnet);
      return { content: [{ type: "text", text: JSON.stringify(hosts, null, 2) }] };
    },
  );

  server.registerTool(
    "scan_host",
    {
      title: "深度主机扫描",
      description: "对指定 IP 执行端口扫描、服务识别和 OS 探测。",
      inputSchema: z.object({
        ip: z.string().describe("目标 IP 地址"),
        ports: z.string().optional().describe("端口范围 (nmap 格式)，默认 1-1000"),
      }),
    },
    async ({ ip, ports = "1-1000" }) => {
      const result = await scanHost(ip, { portRange: ports });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "trace_route",
    {
      title: "路由追踪",
      description: "对目标 IP 执行 traceroute，返回路径跳点列表。",
      inputSchema: z.object({
        target: z.string().describe("目标 IP 地址"),
      }),
    },
    async ({ target }) => {
      const hops = await traceRoute(target);
      return { content: [{ type: "text", text: JSON.stringify(hops, null, 2) }] };
    },
  );

  server.registerTool(
    "build_topology",
    {
      title: "构建拓扑图",
      description: "综合已收集的扫描数据，构建网络拓扑图（节点 + 边）。",
      inputSchema: z.object({
        hosts: z.array(z.object({})).describe("discover_hosts 的输出"),
        hostDetails: z.array(z.object({})).optional().describe("scan_host 的输出数组"),
        traces: z.array(z.object({})).optional().describe("trace_route 的输出数组"),
      }),
    },
    async ({ hosts, hostDetails = [], traces = [] }) => {
      const topology = buildTopology({ hosts, hostDetails, traces });
      return { content: [{ type: "text", text: JSON.stringify(topology, null, 2) }] };
    },
  );

  server.registerTool(
    "full_scan",
    {
      title: "一键全扫描",
      description: "自动执行完整的拓扑发现流程：网段识别 → 主机发现 → 端口扫描 → 路由追踪 → 拓扑构建。扫描完成后请在右侧面板打开 UI 查看拓扑图。",
      inputSchema: z.object({
        startSubnet: z.string().optional().describe("起始网段 (CIDR)。留空则自动识别。"),
      }),
    },
    async ({ startSubnet }) => {
      const scanId = `scan_${Date.now()}`;
      const state = {
        scanId, status: "running", phase: "subnet_detect",
        phases: [
          { name: "subnet_detect", total: 1, done: 0, status: "pending" },
          { name: "host_discovery", total: 0, done: 0, status: "pending" },
          { name: "port_scan", total: 0, done: 0, status: "pending" },
          { name: "topology_build", total: 1, done: 0, status: "pending" },
        ],
        intermediate: { hostsFound: 0, routersFound: 0, switchesFound: 0, edgesFound: 0 },
      };
      setScanState(state);

      state.phases[0].status = "running";
      const subnets = startSubnet
        ? [{ subnet: startSubnet, source: "user", gateway: null }]
        : await discoverSubnets({ includeHeuristic: true });
      state.phases[0].done = 1;
      state.phases[0].status = "done";

      state.phase = "host_discovery";
      state.phases[1].total = subnets.length;
      state.phases[1].status = "running";
      let allHosts = [];
      for (let i = 0; i < subnets.length; i++) {
        if (state._abort) break;
        const s = subnets[i];
        const hosts = await discoverHosts(s.subnet);
        allHosts = allHosts.concat(hosts.map(h => ({ ...h, subnet: s.subnet })));
        state.phases[1].done = i + 1;
        state.intermediate.hostsFound = allHosts.length;
      }
      state.phases[1].status = "done";

      state.phase = "port_scan";
      const scanTargets = allHosts.slice(0, 50);
      state.phases[2].total = scanTargets.length;
      state.phases[2].status = "running";
      let hostDetails = [];
      for (let i = 0; i < scanTargets.length; i++) {
        if (state._abort) break;
        try {
          const detail = await scanHost(scanTargets[i].ip, { portRange: "1-1000" });
          hostDetails.push(detail);
        } catch { /* skip dead hosts */ }
        state.phases[2].done = i + 1;
      }
      state.phases[2].status = "done";

      // Phase 3.5: SNMP discovery on gateway devices
      const snmpResults = {};
      const gatewayHosts = allHosts.filter(h => h.isGateway);
      if (credentialManager && gatewayHosts.length > 0) {
        for (const gw of gatewayHosts.slice(0, 10)) {
          if (blacklist && blacklist.isBlocked(gw.ip)) continue;
          try {
            const result = await credentialManager.trySnmpCredentials(gw.ip, async (cred) => {
              const { discoverSwitchPorts, discoverLLDPNeighbors, discoverVLANs } = await import("../scanner/snmp.js");
              const macTable = await discoverSwitchPorts(gw.ip, cred.community);
              if (Object.keys(macTable).length === 0) return null;
              const lldpNeighbors = await discoverLLDPNeighbors(gw.ip, cred.community);
              const vlans = await discoverVLANs(gw.ip, cred.community);
              return { macTable, lldpNeighbors, vlans };
            });
            if (result) snmpResults[gw.ip] = result;
          } catch { /* SNMP failed for this gateway */ }
        }
      }

      state.phase = "topology_build";
      state.phases[3].status = "running";
      let traces = [];
      const gatewayIps = [...new Set(allHosts.filter(h => h.isGateway).map(h => h.ip))];
      for (const gw of gatewayIps.slice(0, 5)) { // limit to 5 gateways
        try {
          const hops = await traceRoute(gw);
          traces.push({ target: gw, hops });
        } catch { /* skip */ }
      }
      const topology = buildTopology({ hosts: allHosts, hostDetails, traces, snmpResults });
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
