import { isPrivate } from "./heuristics.js";

export function detectBoundaries(nodes, edges, subnets, externalIp) {
  const boundaries = [];

  const byMac = new Map();
  for (const node of nodes) {
    if (!node.mac) continue;
    if (!byMac.has(node.mac)) byMac.set(node.mac, []);
    byMac.get(node.mac).push(node);
  }

  for (const [mac, macNodes] of byMac) {
    if (macNodes.length < 2) continue;
    const uniqueSubnets = [...new Set(macNodes.map(n => n.subnet).filter(Boolean))];
    if (uniqueSubnets.length >= 2) {
      for (let i = 0; i < uniqueSubnets.length - 1; i++) {
        for (let j = i + 1; j < uniqueSubnets.length; j++) {
          boundaries.push({
            type: "vlan", subnetA: uniqueSubnets[i], subnetB: uniqueSubnets[j],
            gatewayId: macNodes[0].id, gatewayMac: mac, confidence: 0.85,
          });
        }
      }
    }
  }

  if (externalIp) {
    const gateways = nodes.filter(n => n.isGateway || n.type === "gateway" || n.type === "router");
    for (const gw of gateways) {
      if (gw.subnet && isPrivate(gw.id)) {
        boundaries.push({ type: "nat", deviceId: gw.id, internalIp: gw.id, externalIp, confidence: 0.9 });
      }
    }
  }

  const firewalls = nodes.filter(n => n.type === "firewall");
  for (const fw of firewalls) {
    boundaries.push({ type: "firewall", deviceId: fw.id, blockedPorts: [], reachabilityMatrix: {}, confidence: fw.roleConfidence || 0.75 });
  }

  for (const subnet of subnets) {
    const subnetNodes = nodes.filter(n => n.subnet === subnet);
    if (subnetNodes.length === 0 || subnetNodes.length > 10) continue;
    const allPorts = subnetNodes.flatMap(n => (n.ports || []).map(p => p.port));
    const webPorts = allPorts.filter(p => [80, 443, 8080, 8443].includes(p));
    const ratio = allPorts.length > 0 ? webPorts.length / allPorts.length : 0;
    if (ratio > 0.6 && subnetNodes.length <= 5) {
      boundaries.push({ type: "dmz", subnet, deviceCount: subnetNodes.length, serviceProfile: "web-dominated", confidence: 0.5 });
    }
  }

  return boundaries;
}
