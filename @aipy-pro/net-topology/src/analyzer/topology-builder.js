export function buildTopology({ hosts, hostDetails = [], traces = [] }) {
  const nodes = [];
  const edges = [];
  const subnetsSeen = new Set();

  const detailByIp = new Map();
  for (const d of hostDetails) {
    if (d.ip) detailByIp.set(d.ip, d);
  }

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

  const gateways = nodes.filter(n => n.isGateway);
  const endpoints = nodes.filter(n => !n.isGateway);

  const subnetGateway = new Map();
  for (const g of gateways) {
    if (g.subnet) subnetGateway.set(g.subnet, g.id);
  }

  for (const ep of endpoints) {
    const gw = subnetGateway.get(ep.subnet);
    if (gw && gw !== ep.id) {
      edges.push({
        source: ep.id, target: gw, type: "l3_route",
        confidence: 0.9, method: "subnet_gateway", label: "subnet route",
      });
    }
  }

  for (const trace of traces) {
    if (!trace.hops || trace.hops.length < 2) continue;
    for (let i = 0; i < trace.hops.length - 1; i++) {
      edges.push({
        source: trace.hops[i].ip, target: trace.hops[i + 1].ip,
        type: "l3_route", confidence: 0.85, method: "traceroute",
        label: `hop ${trace.hops[i].hop}→${trace.hops[i + 1].hop}`,
      });
    }
  }

  const edgeSet = new Set();
  const uniqueEdges = [];
  for (const e of edges) {
    const key = `${e.source}→${e.target}::${e.type}`;
    if (!edgeSet.has(key)) { edgeSet.add(key); uniqueEdges.push(e); }
  }

  const scanId = `scan_${Date.now()}`;
  return {
    scanId, createdAt: new Date().toISOString(),
    subnetsScanned: Array.from(subnetsSeen),
    topology: { nodes, edges: uniqueEdges },
    boundaries: [],
    statistics: {
      hostsFound: nodes.length, routers: gateways.length, switches: 0,
      firewalls: 0, endpoints: endpoints.length, edgesFound: uniqueEdges.length,
      subnetsFound: subnetsSeen.size, scanDurationMs: 0,
    },
  };
}

function guessSubnet(ip) {
  const parts = ip.split(".").map(Number);
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}
