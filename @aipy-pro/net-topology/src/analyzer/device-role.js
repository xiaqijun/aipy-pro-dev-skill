import { lookupVendor, isNetworkVendor, ROUTER_PORTS, FIREWALL_PORTS } from "./heuristics.js";

export function identifyDeviceRole(ip, hostData, allHosts, traces, snmpData) {
  const reasons = [];
  let type = "endpoint";
  let confidence = 0.5;

  const mac = hostData.mac;
  const ports = hostData.ports || [];
  const portNumbers = ports.map(p => p.port);

  // Rule 1: Multi-homed MAC → router (HIGH)
  if (mac) {
    const otherSubnets = allHosts.filter(h => h.mac === mac && h.subnet !== hostData.subnet && h.ip !== ip);
    if (otherSubnets.length > 0) {
      reasons.push("multi-homed: same MAC on multiple subnets");
      type = "router"; confidence = Math.max(confidence, 0.95);
    }
  }

  // Rule 2: Intermediate hop in traceroute → router (HIGH)
  const tracerouteHops = traces.flatMap(t => (t.hops || []).filter(h => h.ip === ip && h.hop < (t.hops || []).length));
  if (tracerouteHops.length > 0) {
    reasons.push(`traceroute hop: appears in ${tracerouteHops.length} paths`);
    type = "router"; confidence = Math.max(confidence, 0.9);
  }

  // Rule 3: BGP port → router (HIGH)
  if (portNumbers.includes(179)) {
    reasons.push("BGP port 179/tcp open");
    type = "router"; confidence = Math.max(confidence, 0.95);
  }

  // Rule 4: RIP port → router (MEDIUM)
  if (portNumbers.includes(520) || portNumbers.includes(521)) {
    reasons.push("RIP port open");
    type = "router"; confidence = Math.max(confidence, 0.8);
  }

  // Rule 5: SNMP MAC table → switch (HIGH)
  if (snmpData && snmpData.macTable) {
    const portCount = Object.keys(snmpData.macTable).length;
    if (portCount > 0) {
      reasons.push(`SNMP MAC address table: ${portCount} ports`);
      type = "switch"; confidence = 0.9;
    }
  }

  // Rule 6: LLDP neighbors → switch (HIGH)
  if (snmpData && snmpData.lldpNeighbors && snmpData.lldpNeighbors.length > 0) {
    reasons.push(`LLDP: ${snmpData.lldpNeighbors.length} neighbors`);
    type = "switch"; confidence = Math.max(confidence, 0.95);
  }

  // Rule 7: Network vendor OUI + port pattern
  if (type === "endpoint" && isNetworkVendor(mac)) {
    const vendor = lookupVendor(mac);
    if (portNumbers.some(p => ROUTER_PORTS.includes(p))) {
      reasons.push(`network vendor (${vendor}) + routing ports`);
      type = "router"; confidence = 0.7;
    } else {
      reasons.push(`network vendor (${vendor}), presumed switch`);
      type = "switch"; confidence = 0.6;
    }
  }

  // Rule 8: Firewall port pattern
  if (portNumbers.includes(8443) || portNumbers.includes(10443)) {
    if ([22, 443].some(p => portNumbers.includes(p))) {
      reasons.push("firewall management port pattern (8443/10443 + mgmt)");
      type = "firewall"; confidence = 0.75;
    }
  }

  // Rule 9: Default gateway address
  if (hostData.isGateway && type === "endpoint") {
    reasons.push("default gateway address (.1)");
    type = "gateway"; confidence = 0.65;
  }

  return { type, confidence, reasons };
}
