# NetTopology Phase 2 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add device role identification (router/switch/firewall), network boundary discovery, SNMP data collection, credential management, and security controls to the Phase 1 MVP.

**Architecture:** New scanner module (SNMP), three analyzer modules (device-role, boundary-detector, heuristics), security module (credential manager), and enhancements to existing topology-builder, tools.js, and Web UI.

**Tech Stack:** Node.js ≥18, `@modelcontextprotocol/sdk`, Express.js, Cytoscape.js, better-sqlite3, `snmp-native` (new)

## Global Constraints

- Same as Phase 1 — all constraints from the spec apply
- Credentials NEVER written to disk, logs, or transmitted — memory only
- SNMP v2c community strings configurable, v3 optional
- Scan warnings MUST display before any active scan
- Blacklist MUST be checked before probing any IP

---

## File Structure (Phase 2 additions)

```
@aipy-pro/net-topology/
└── src/
    ├── scanner/
    │   └── snmp.js              ← NEW: SNMP data collection
    ├── analyzer/
    │   ├── device-role.js       ← NEW: router/switch/firewall classification
    │   ├── boundary-detector.js ← NEW: NAT/firewall/VLAN/DMZ detection
    │   └── heuristics.js        ← NEW: shared heuristic constants/rules
    └── security.js              ← NEW: credential manager + blacklist
```

---

### Task 11: SNMP Scanner

**Files:**
- Create: `@aipy-pro/net-topology/src/scanner/snmp.js`
- Create: `@aipy-pro/net-topology/test/scanner/snmp.test.js`

**Produces:** `snmpGet(ip, community, oids)`, `snmpWalk(ip, community, oid)`, `discoverSwitchPorts(ip, community)`, `discoverLLDPNeighbors(ip, community)`, `discoverVLANs(ip, community)`

Add `snmp-native` to package.json dependencies.

- [ ] **Step 1: Add snmp-native dependency**

```bash
cd @aipy-pro/net-topology && npm install snmp-native
```

- [ ] **Step 2: Write failing test**

```js
// test/scanner/snmp.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { snmpGet, snmpWalk, OIDS } from "../../src/scanner/snmp.js";

describe("SNMP scanner", () => {
  it("OIDS has required keys", () => {
    assert.ok(OIDS.dot1dTpFdbTable);
    assert.ok(OIDS.lldpRemTable);
    assert.ok(OIDS.vlanTable);
    assert.ok(OIDS.sysDescr);
    assert.ok(OIDS.ipRouteTable);
  });

  it("snmpGet returns null for unreachable host", async () => {
    const result = await snmpGet("192.0.2.1", "public", [OIDS.sysDescr]);
    assert.equal(result, null);
  });

  it("snmpWalk returns empty array for unreachable host", async () => {
    const result = await snmpWalk("192.0.2.1", "public", OIDS.dot1dTpFdbTable);
    assert.deepEqual(result, []);
  });
});
```

- [ ] **Step 3: Run test — expected FAIL**

```bash
node --test test/scanner/snmp.test.js
```

- [ ] **Step 4: Write implementation**

```js
// src/scanner/snmp.js
import snmp from "snmp-native";

export const OIDS = {
  sysDescr:        [1, 3, 6, 1, 2, 1, 1, 1, 0],
  sysName:         [1, 3, 6, 1, 2, 1, 1, 5, 0],
  sysObjectID:     [1, 3, 6, 1, 2, 1, 1, 2, 0],
  ipRouteTable:    [1, 3, 6, 1, 2, 1, 4, 21],
  dot1dTpFdbTable: [1, 3, 6, 1, 2, 1, 17, 4, 3],
  lldpRemTable:    [1, 0, 8802, 1, 1, 2, 1, 4],
  lldpRemPortId:   [1, 0, 8802, 1, 1, 2, 1, 4, 1, 2],
  lldpRemSysName:  [1, 0, 8802, 1, 1, 2, 1, 4, 1, 4],
  vlanTable:       [1, 3, 6, 1, 2, 1, 17, 7, 1, 4, 2, 1, 3],
  vlanName:        [1, 3, 6, 1, 2, 1, 17, 7, 1, 4, 3, 1, 1],
  ifTable:         [1, 3, 6, 1, 2, 1, 2, 2],
};

// Single or few OID GET — returns parsed values or null
export async function snmpGet(ip, community, oids, opts = {}) {
  const { timeout = 3000 } = opts;
  return new Promise((resolve) => {
    const session = new snmp.Session({ host: ip, community, timeouts: [timeout] });
    const results = {};
    let responded = false;

    session.get({ oids }, (err, varbinds) => {
      if (responded) return;
      responded = true;
      session.close();
      if (err) { resolve(null); return; }
      for (const vb of varbinds) {
        if (vb.value !== undefined) {
          results[vb.oid.join(".")] = vb.value;
        }
      }
      resolve(Object.keys(results).length > 0 ? results : null);
    });

    setTimeout(() => {
      if (!responded) { responded = true; session.close(); resolve(null); }
    }, timeout);
  });
}

// Bulk WALK — returns array of { oid, value }
export async function snmpWalk(ip, community, baseOid, opts = {}) {
  const { timeout = 5000, maxVarbinds = 500 } = opts;
  return new Promise((resolve) => {
    const session = new snmp.Session({ host: ip, community, timeouts: [timeout] });
    const results = [];

    function walk(oid) {
      session.getSubtree({ oid, combinedTimeout: timeout }, (err, varbinds) => {
        if (err || !varbinds || varbinds.length === 0) {
          session.close();
          resolve(results);
          return;
        }
        for (const vb of varbinds) {
          results.push({ oid: vb.oid.join("."), value: vb.value });
          if (results.length >= maxVarbinds) { session.close(); resolve(results); return; }
        }
        session.close();
        resolve(results);
      });
    }
    walk(baseOid);

    setTimeout(() => { session.close(); resolve(results); }, timeout);
  });
}

// Discover switch port → MAC mappings from dot1dTpFdbTable
export async function discoverSwitchPorts(ip, community) {
  const entries = await snmpWalk(ip, community, OIDS.dot1dTpFdbTable);
  const macByPort = {};
  for (const e of entries) {
    const oidParts = e.oid.split(".");
    const port = oidParts[oidParts.length - 1];
    const mac = typeof e.value === "string" ? e.value : formatMac(e.value);
    if (!macByPort[port]) macByPort[port] = [];
    macByPort[port].push(mac);
  }
  return macByPort;
}

// Discover LLDP neighbors
export async function discoverLLDPNeighbors(ip, community) {
  const entries = await snmpWalk(ip, community, OIDS.lldpRemTable);
  const neighbors = [];
  const current = {};
  for (const e of entries) {
    current.oid = e.oid;
    if (e.oid.includes(OIDS.lldpRemSysName.join("."))) {
      current.sysName = String(e.value);
    }
    if (e.oid.includes(OIDS.lldpRemPortId.join("."))) {
      current.portId = String(e.value);
      neighbors.push({ ...current });
    }
  }
  return neighbors;
}

// Discover VLAN assignments
export async function discoverVLANs(ip, community) {
  const entries = await snmpWalk(ip, community, OIDS.vlanTable);
  const vlans = {};
  for (const e of entries) {
    const parts = e.oid.split(".");
    const vlanId = parts[parts.length - 1];
    if (!vlans[vlanId]) vlans[vlanId] = { vlanId: parseInt(vlanId), ports: [] };
  }
  return Object.values(vlans);
}

function formatMac(value) {
  if (Buffer.isBuffer(value)) {
    return Array.from(value).map(b => b.toString(16).padStart(2, "0")).join(":");
  }
  return String(value);
}
```

- [ ] **Step 5: Run test — expected PASS**

```bash
node --test test/scanner/snmp.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/scanner/snmp.js test/scanner/snmp.test.js package.json package-lock.json
git commit -m "feat: SNMP scanner — GET, WALK, switch ports, LLDP neighbors, VLAN discovery"
```

---

### Task 12: Heuristics Module

**Files:**
- Create: `@aipy-pro/net-topology/src/analyzer/heuristics.js`

**Produces:** Shared OUI database, well-known port patterns, heuristic constants used by device-role and boundary-detector.

- [ ] **Step 1: Write heuristics.js**

```js
// src/analyzer/heuristics.js

// Extended OUI database for network equipment vendors
export const OUI_VENDORS = {
  "00000c": "Cisco Systems",
  "001a30": "Juniper Networks",
  "00095b": "Netgear",
  "001b17": "Palo Alto Networks",
  "00090f": "Fortinet",
  "001c7e": "Check Point",
  "0050ba": "D-Link",
  "0017a4": "Hewlett Packard Enterprise",
  "3c8c40": "Huawei Technologies",
  "74882a": "H3C Technologies",
  "001018": "Broadcom",
  "40a6e8": "Aruba Networks",
  "f09fc2": "Ubiquiti Networks",
  "001256": "Dell",
  "b8ca3a": "Dell",
  "001372": "Dell",
  "e02f6d": "Cisco Meraki",
  "88f077": "Cisco Meraki",
  "ac86c9": "MikroTik",
  "2c9e5f": "Arista Networks",
  "001c73": "Arista Networks",
  "001977": "Allied Telesis",
  "e0071b": "Hewlett Packard",
  "001ec2": "Intel",
  "001320": "Intel",
  "0cc47a": "Supermicro",
};

// Router-specific port patterns
export const ROUTER_PORTS = [179, 520, 521, 1985];

// Firewall-specific port patterns
export const FIREWALL_PORTS = [8443, 10443];

// Management ports common on network infrastructure devices
export const MGMT_PORTS = [22, 23, 80, 161, 443];

// RFC 1918 private address ranges
export const PRIVATE_RANGES = [
  { network: [10, 0, 0, 0], prefix: 8 },
  { network: [172, 16, 0, 0], prefix: 12 },
  { network: [192, 168, 0, 0], prefix: 16 },
];

export function lookupVendor(mac) {
  if (!mac) return null;
  const prefix = mac.replace(/[:\-]/g, "").substring(0, 6).toLowerCase();
  return OUI_VENDORS[prefix] || null;
}

export function isNetworkVendor(mac) {
  return lookupVendor(mac) !== null;
}

export function ipToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
}

export function isPrivate(ip) {
  const int = ipToInt(ip);
  for (const range of PRIVATE_RANGES) {
    const netInt = range.network.reduce((a, o) => (a << 8) + o, 0) >>> 0;
    const mask = (~0) << (32 - range.prefix);
    if ((int & mask) === (netInt & mask)) return true;
  }
  return false;
}

export function isIpInSubnet(ip, cidr) {
  const [net, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr);
  const ipInt = ipToInt(ip);
  const netInt = ipToInt(net);
  const mask = (~0) << (32 - prefix);
  return (ipInt & mask) === (netInt & mask);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/analyzer/heuristics.js
git commit -m "feat: shared heuristics module — OUI database, port patterns, IP utilities"
```

---

### Task 13: Device Role Analyzer

**Files:**
- Create: `@aipy-pro/net-topology/src/analyzer/device-role.js`
- Create: `@aipy-pro/net-topology/test/analyzer/device-role.test.js`

**Produces:** `identifyDeviceRole(ip, hostData, allHosts, traces, snmpData)` → `{ type, confidence, reasons }`
**Consumes:** heuristics.js from Task 12, snmp.js from Task 11

- [ ] **Step 1: Write failing test**

```js
// test/analyzer/device-role.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { identifyDeviceRole } from "../../src/analyzer/device-role.js";

describe("identifyDeviceRole", () => {
  const basicHost = { ip: "192.168.1.100", mac: "aa:bb:cc:dd:ee:01", ports: [], status: "up" };

  it("identifies endpoint for basic host", () => {
    const result = identifyDeviceRole("192.168.1.100", basicHost, [], [], null);
    assert.equal(result.type, "endpoint");
    assert.ok(result.confidence >= 0.5);
  });

  it("identifies router by multi-homed MAC", () => {
    const allHosts = [
      { ip: "192.168.1.1", mac: "00:00:0c:11:22:01", subnet: "192.168.1.0/24", ports: [] },
      { ip: "10.0.0.1", mac: "00:00:0c:11:22:01", subnet: "10.0.0.0/24", ports: [] },
    ];
    // Same MAC on two subnets → router
    const result = identifyDeviceRole("192.168.1.1", allHosts[0], allHosts, [], null);
    assert.equal(result.type, "router");
    assert.ok(result.confidence >= 0.8);
    assert.ok(result.reasons.some(r => r.includes("multi-homed")));
  });

  it("identifies router by traceroute hop", () => {
    const traces = [
      { target: "10.0.0.5", hops: [{ hop: 1, ip: "192.168.1.1" }, { hop: 2, ip: "10.0.0.5" }] },
    ];
    const result = identifyDeviceRole("192.168.1.1", basicHost, [basicHost], traces, null);
    assert.equal(result.type, "router");
    assert.ok(result.reasons.some(r => r.includes("traceroute hop")));
  });

  it("identifies router by BGP port", () => {
    const host = { ...basicHost, ip: "10.0.0.1", ports: [{ port: 179, service: "bgp" }] };
    const result = identifyDeviceRole("10.0.0.1", host, [host], [], null);
    assert.equal(result.type, "router");
  });

  it("identifies switch by SNMP MAC table", () => {
    const snmpData = { macTable: { "1": ["aa:bb:cc:11:22:01"], "2": ["aa:bb:cc:11:22:02", "aa:bb:cc:11:22:03"] } };
    const result = identifyDeviceRole("192.168.1.2", basicHost, [basicHost], [], snmpData);
    assert.equal(result.type, "switch");
    assert.ok(result.confidence >= 0.8);
  });

  it("identifies firewall by port pattern", () => {
    const host = {
      ...basicHost,
      ip: "10.0.0.254",
      ports: [{ port: 443, service: "https" }, { port: 8443, service: "https-alt" }, { port: 22, service: "ssh" }],
    };
    const result = identifyDeviceRole("10.0.0.254", host, [host], [], null);
    assert.equal(result.type, "firewall");
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
node --test test/analyzer/device-role.test.js
```

- [ ] **Step 3: Write implementation**

```js
// src/analyzer/device-role.js
import { lookupVendor, isNetworkVendor, ROUTER_PORTS, FIREWALL_PORTS } from "./heuristics.js";

export function identifyDeviceRole(ip, hostData, allHosts, traces, snmpData) {
  const reasons = [];
  let type = "endpoint";
  let confidence = 0.5;

  const mac = hostData.mac;
  const ports = hostData.ports || [];
  const portNumbers = ports.map(p => p.port);

  // Rule 1: Multi-homed MAC → router (HIGH confidence)
  if (mac) {
    const otherSubnets = allHosts.filter(
      h => h.mac === mac && h.subnet !== hostData.subnet && h.ip !== ip
    );
    if (otherSubnets.length > 0) {
      reasons.push("multi-homed: same MAC on multiple subnets");
      type = "router";
      confidence = Math.max(confidence, 0.95);
    }
  }

  // Rule 2: Appears as intermediate hop in traceroute → router (HIGH)
  const tracerouteHops = traces.flatMap(t => (t.hops || []).filter(
    h => h.ip === ip && h.hop < (t.hops || []).length
  ));
  if (tracerouteHops.length > 0) {
    reasons.push(`traceroute hop: appears in ${tracerouteHops.length} paths`);
    type = "router";
    confidence = Math.max(confidence, 0.9);
  }

  // Rule 3: BGP port → router (HIGH)
  if (portNumbers.includes(179)) {
    reasons.push("BGP port 179/tcp open");
    type = "router";
    confidence = Math.max(confidence, 0.95);
  }

  // Rule 4: RIP port → router (MEDIUM)
  if (portNumbers.includes(520) || portNumbers.includes(521)) {
    reasons.push("RIP port open");
    type = "router";
    confidence = Math.max(confidence, 0.8);
  }

  // Rule 5: SNMP MAC table data → switch (HIGH)
  if (snmpData && snmpData.macTable) {
    const portCount = Object.keys(snmpData.macTable).length;
    if (portCount > 0) {
      reasons.push(`SNMP MAC address table: ${portCount} ports`);
      type = "switch";
      confidence = 0.9;
    }
  }

  // Rule 6: LLDP neighbor data → switch (HIGH)
  if (snmpData && snmpData.lldpNeighbors && snmpData.lldpNeighbors.length > 0) {
    reasons.push(`LLDP: ${snmpData.lldpNeighbors.length} neighbors`);
    type = "switch";
    confidence = Math.max(confidence, 0.95);
  }

  // Rule 7: OUI network vendor + port pattern → switch vs router
  if (type === "endpoint" && isNetworkVendor(mac)) {
    const vendor = lookupVendor(mac);
    // Check for router-specific ports
    if (portNumbers.some(p => ROUTER_PORTS.includes(p))) {
      reasons.push(`network vendor (${vendor}) + routing ports`);
      type = "router";
      confidence = 0.7;
    } else {
      reasons.push(`network vendor (${vendor}), presumed switch`);
      type = "switch";
      confidence = 0.6;
    }
  }

  // Rule 8: Firewall port pattern (8443 + 443 + SSH)
  if (portNumbers.includes(8443) || portNumbers.includes(10443)) {
    const hasMgmt = [22, 443].some(p => portNumbers.includes(p));
    if (hasMgmt) {
      reasons.push("firewall management port pattern (8443/10443 + mgmt)");
      type = "firewall";
      confidence = 0.75;
    }
  }

  // Rule 9: Device is gateway (.1 address) → could be router
  if (hostData.isGateway && type === "endpoint") {
    reasons.push("default gateway address (.1)");
    type = "gateway";
    confidence = 0.65;
  }

  return { type, confidence, reasons };
}
```

- [ ] **Step 4: Run test — expected PASS**

```bash
node --test test/analyzer/device-role.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/device-role.js test/analyzer/device-role.test.js
git commit -m "feat: device role analyzer — router/switch/firewall/gateway classification"
```

---

### Task 14: Network Boundary Detector

**Files:**
- Create: `@aipy-pro/net-topology/src/analyzer/boundary-detector.js`
- Create: `@aipy-pro/net-topology/test/analyzer/boundary-detector.test.js`

**Produces:** `detectBoundaries(nodes, edges, subnets, externalIp)` → `[{ type, ... }]`
**Consumes:** heuristics.js

- [ ] **Step 1: Write failing test**

```js
// test/analyzer/boundary-detector.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { detectBoundaries } from "../../src/analyzer/boundary-detector.js";

describe("detectBoundaries", () => {
  it("returns array of boundaries", () => {
    const nodes = [
      { id: "192.168.1.1", subnet: "192.168.1.0/24", isGateway: true, type: "router", mac: "aa:bb:cc:dd:ee:01" },
      { id: "10.0.0.1", subnet: "10.0.0.0/24", isGateway: true, type: "router", mac: "aa:bb:cc:dd:ee:01" },
      { id: "192.168.1.100", subnet: "192.168.1.0/24", isGateway: false, type: "endpoint", mac: "aa:bb:cc:dd:ee:02" },
    ];
    const boundaries = detectBoundaries(nodes, [], ["192.168.1.0/24", "10.0.0.0/24"], null);
    assert.ok(Array.isArray(boundaries));
  });

  it("detects VLAN boundary when same MAC appears on different subnets", () => {
    const nodes = [
      { id: "192.168.1.1", subnet: "192.168.1.0/24", isGateway: true, type: "router", mac: "00:00:0c:11:22:01" },
      { id: "10.0.0.1", subnet: "10.0.0.0/24", isGateway: true, type: "router", mac: "00:00:0c:11:22:01" },
    ];
    const boundaries = detectBoundaries(nodes, [], ["192.168.1.0/24", "10.0.0.0/24"], null);
    const vlanBounds = boundaries.filter(b => b.type === "vlan");
    assert.ok(vlanBounds.length > 0);
    assert.ok(vlanBounds[0].gatewayId === "192.168.1.1" || vlanBounds[0].gatewayId === "10.0.0.1");
  });

  it("detects NAT boundary with external IP", () => {
    const nodes = [
      { id: "192.168.1.254", subnet: "192.168.1.0/24", isGateway: true, type: "router", mac: "aa:bb:cc:dd:ee:ff" },
    ];
    const boundaries = detectBoundaries(nodes, [], ["192.168.1.0/24"], "203.0.113.5");
    const natBounds = boundaries.filter(b => b.type === "nat");
    assert.ok(natBounds.length > 0);
    assert.equal(natBounds[0].externalIp, "203.0.113.5");
    assert.equal(natBounds[0].deviceId, "192.168.1.254");
  });

  it("returns empty array for simple single-subnet network", () => {
    const nodes = [
      { id: "192.168.1.1", subnet: "192.168.1.0/24", isGateway: true, type: "gateway", mac: "aa:bb:cc:dd:ee:01" },
      { id: "192.168.1.100", subnet: "192.168.1.0/24", isGateway: false, type: "endpoint", mac: "aa:bb:cc:dd:ee:02" },
    ];
    const boundaries = detectBoundaries(nodes, [], ["192.168.1.0/24"], null);
    assert.equal(boundaries.length, 0);
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
node --test test/analyzer/boundary-detector.test.js
```

- [ ] **Step 3: Write implementation**

```js
// src/analyzer/boundary-detector.js
import { isPrivate, isIpInSubnet } from "./heuristics.js";

export function detectBoundaries(nodes, edges, subnets, externalIp) {
  const boundaries = [];

  // Group nodes by MAC to find multi-homed gateways
  const byMac = new Map();
  for (const node of nodes) {
    if (!node.mac) continue;
    if (!byMac.has(node.mac)) byMac.set(node.mac, []);
    byMac.get(node.mac).push(node);
  }

  // VLAN/Subnet boundary: same MAC on multiple subnets
  for (const [mac, macNodes] of byMac) {
    if (macNodes.length < 2) continue;
    const uniqueSubnets = [...new Set(macNodes.map(n => n.subnet).filter(Boolean))];
    if (uniqueSubnets.length >= 2) {
      for (let i = 0; i < uniqueSubnets.length - 1; i++) {
        for (let j = i + 1; j < uniqueSubnets.length; j++) {
          boundaries.push({
            type: "vlan",
            subnetA: uniqueSubnets[i],
            subnetB: uniqueSubnets[j],
            gatewayId: macNodes[0].id,
            gatewayMac: mac,
            confidence: 0.85,
          });
        }
      }
    }
  }

  // NAT boundary: gateway with external IP
  if (externalIp) {
    const gateways = nodes.filter(n => n.isGateway || n.type === "gateway" || n.type === "router");
    for (const gw of gateways) {
      if (gw.subnet && isPrivate(gw.id)) {
        boundaries.push({
          type: "nat",
          deviceId: gw.id,
          internalIp: gw.id,
          externalIp,
          confidence: 0.9,
        });
      }
    }
  }

  // Firewall detection: device classified as "firewall"
  const firewalls = nodes.filter(n => n.type === "firewall");
  for (const fw of firewalls) {
    boundaries.push({
      type: "firewall",
      deviceId: fw.id,
      blockedPorts: [],  // populated in later phases with reachability analysis
      reachabilityMatrix: {},
      confidence: fw.roleConfidence || 0.75,
    });
  }

  // DMZ detection heuristic: small subnet with only web/DNS services
  for (const subnet of subnets) {
    const subnetNodes = nodes.filter(n => n.subnet === subnet);
    if (subnetNodes.length === 0) continue;
    if (subnetNodes.length > 10) continue; // DMZ usually small

    const allPorts = subnetNodes.flatMap(n => (n.ports || []).map(p => p.port));
    const webPorts = allPorts.filter(p => [80, 443, 8080, 8443].includes(p));
    const ratio = allPorts.length > 0 ? webPorts.length / allPorts.length : 0;
    if (ratio > 0.6 && subnetNodes.length <= 5) {
      boundaries.push({
        type: "dmz",
        subnet,
        deviceCount: subnetNodes.length,
        serviceProfile: "web-dominated",
        confidence: 0.5,
      });
    }
  }

  return boundaries;
}
```

- [ ] **Step 4: Run test — expected PASS**

```bash
node --test test/analyzer/boundary-detector.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/boundary-detector.js test/analyzer/boundary-detector.test.js
git commit -m "feat: network boundary detector — VLAN, NAT, firewall, DMZ detection"
```

---

### Task 15: Credential Manager + Blacklist

**Files:**
- Create: `@aipy-pro/net-topology/src/security.js`
- Create: `@aipy-pro/net-topology/test/security.test.js`

**Produces:** `CredentialManager` class (addCredential, tryCredentials, clear), `Blacklist` class (add, remove, isBlocked, toList)

- [ ] **Step 1: Write failing test**

```js
// test/security.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { CredentialManager, Blacklist } from "../src/security.js";

describe("CredentialManager", () => {
  it("stores and retrieves SNMP credentials", () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("public");
    cm.addSnmpV2("private");
    const snmp = cm.getSnmpCredentials();
    assert.equal(snmp.length, 2);
    assert.equal(snmp[0].community, "public");
    assert.equal(snmp[1].community, "private");
  });

  it("tryCredentials iterates all credentials", async () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("public");
    cm.addSnmpV2("private");
    const results = [];
    await cm.trySnmpCredentials("192.0.2.1", async (cred) => {
      results.push(cred.community);
      return null;
    });
    assert.deepEqual(results, ["public", "private"]);
  });

  it("credentials not serialized to JSON", () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("secret123");
    const json = JSON.stringify(cm);
    assert.ok(!json.includes("secret123"));
  });

  it("clear removes all credentials", () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("public");
    cm.clear();
    assert.equal(cm.getSnmpCredentials().length, 0);
  });
});

describe("Blacklist", () => {
  it("blocks listed IPs", () => {
    const bl = new Blacklist();
    bl.add("192.168.1.100");
    assert.equal(bl.isBlocked("192.168.1.100"), true);
    assert.equal(bl.isBlocked("192.168.1.101"), false);
  });

  it("blocks CIDR subnets", () => {
    const bl = new Blacklist();
    bl.add("10.0.0.0/24");
    assert.equal(bl.isBlocked("10.0.0.50"), true);
    assert.equal(bl.isBlocked("10.0.1.1"), false);
  });

  it("remove unblocks", () => {
    const bl = new Blacklist();
    bl.add("192.168.1.100");
    bl.remove("192.168.1.100");
    assert.equal(bl.isBlocked("192.168.1.100"), false);
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
node --test test/security.test.js
```

- [ ] **Step 3: Write implementation**

```js
// src/security.js
import { isIpInSubnet } from "./analyzer/heuristics.js";

// CredentialManager — credentials held in memory only, never serialized
export class CredentialManager {
  #snmpV2 = [];
  #snmpV3 = [];
  #sshCredentials = [];

  addSnmpV2(community) {
    this.#snmpV2.push({ type: "v2c", community });
  }

  addSnmpV3(username, authProtocol, authPassword, privacyProtocol, privacyPassword) {
    this.#snmpV3.push({ type: "v3", username, authProtocol, authPassword, privacyProtocol, privacyPassword });
  }

  addSSH(username, password, privateKey) {
    this.#sshCredentials.push({ type: "ssh", username, password, privateKey });
  }

  getSnmpCredentials() {
    return [...this.#snmpV2, ...this.#snmpV3];
  }

  getSSHCredentials() {
    return [...this.#sshCredentials];
  }

  // Try each credential in order, return first non-null result
  async trySnmpCredentials(ip, fn) {
    const creds = this.getSnmpCredentials();
    for (const cred of creds) {
      try {
        const result = await fn(cred);
        if (result !== null) return result;
      } catch { /* next credential */ }
    }
    return null;
  }

  clear() {
    this.#snmpV2 = [];
    this.#snmpV3 = [];
    this.#sshCredentials = [];
  }

  // Prevent credential serialization
  toJSON() {
    return {
      snmpV2Count: this.#snmpV2.length,
      snmpV3Count: this.#snmpV3.length,
      sshCount: this.#sshCredentials.length,
    };
  }
}

// Blacklist — IP and CIDR blocking
export class Blacklist {
  #entries = []; // [{ type: "ip"|"cidr", value, cidrNet?, cidrPrefix? }]

  add(target) {
    if (target.includes("/")) {
      const [net, prefix] = target.split("/");
      this.#entries.push({ type: "cidr", value: target, cidrNet: net, cidrPrefix: parseInt(prefix) });
    } else {
      this.#entries.push({ type: "ip", value: target });
    }
  }

  remove(target) {
    this.#entries = this.#entries.filter(e => e.value !== target);
  }

  isBlocked(ip) {
    for (const e of this.#entries) {
      if (e.type === "ip" && e.value === ip) return true;
      if (e.type === "cidr" && isIpInSubnet(ip, e.value)) return true;
    }
    return false;
  }

  toList() {
    return this.#entries.map(e => e.value);
  }

  clear() {
    this.#entries = [];
  }
}
```

- [ ] **Step 4: Run test — expected PASS**

```bash
node --test test/security.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/security.js test/security.test.js
git commit -m "feat: credential manager (memory-only) and IP/CIDR blacklist"
```

---

### Task 16: Enhance Topology Builder with Phase 2 Features

**Files:**
- Modify: `@aipy-pro/net-topology/src/analyzer/topology-builder.js`
- Modify: `@aipy-pro/net-topology/src/mcp/tools.js`
- Modify: `@aipy-pro/net-topology/test/analyzer/topology-builder.test.js`

**Produces:** Builder now calls device-role and boundary-detector, tools.js `full_scan` integrates SNMP + credentials + blacklist.

- [ ] **Step 1: Enhance topology-builder.js**

Add imports:
```js
import { identifyDeviceRole } from "./device-role.js";
import { detectBoundaries } from "./boundary-detector.js";
```

Update `buildTopology` signature to accept new params:
```js
export function buildTopology({ hosts, hostDetails = [], traces = [], snmpResults = {}, externalIp = null }) {
```

After node creation loop, add device role classification:
```js
  // Classify each node's device role
  for (const node of nodes) {
    const hostData = hosts.find(h => h.ip === node.id) || {};
    const snmpData = snmpResults[node.id] || null;
    const role = identifyDeviceRole(node.id, { ...hostData, ...node }, hosts, traces, snmpData);
    node.type = role.type;
    node.roleConfidence = role.confidence;
    // Store reasons as metadata
    node._roleReasons = role.reasons;
  }
```

After edge dedup, add boundary detection:
```js
  const boundaries = detectBoundaries(nodes, uniqueEdges, Array.from(subnetsSeen), externalIp);
```

Update statistics:
```js
  const stats = {
    hostsFound: nodes.length,
    routers: nodes.filter(n => n.type === "router").length,
    switches: nodes.filter(n => n.type === "switch").length,
    firewalls: nodes.filter(n => n.type === "firewall").length,
    endpoints: nodes.filter(n => n.type === "endpoint").length,
    edgesFound: uniqueEdges.length,
    subnetsFound: subnetsSeen.size,
    boundariesFound: boundaries.length,
    scanDurationMs: 0,
  };
```

Return boundaries:
```js
  return { scanId, createdAt, subnetsScanned: Array.from(subnetsSeen), topology: { nodes, edges: uniqueEdges }, boundaries, statistics: stats };
```

- [ ] **Step 2: Enhance tools.js full_scan**

The `full_scan` tool now needs: SNMP integration, credential try loop, blacklist checking. Add to the tool registration scope access to CredentialManager and Blacklist instances.

Add to the registerTools signature: `registerTools(server, { getScanState, setScanState, credentialManager, blacklist })`

In `full_scan`, add SNMP phase after port_scan:
```js
      // Phase 3.5: SNMP discovery (on gateway devices)
      const snmpResults = {};
      const gateways = allHosts.filter(h => h.isGateway);
      for (const gw of gateways.slice(0, 10)) {
        if (blacklist && blacklist.isBlocked(gw.ip)) continue;
        const result = await credentialManager.trySnmpCredentials(gw.ip, async (cred) => {
          const { discoverSwitchPorts, discoverLLDPNeighbors, discoverVLANs } = await import("../scanner/snmp.js");
          const macTable = await discoverSwitchPorts(gw.ip, cred.community);
          if (Object.keys(macTable).length === 0) return null; // try next credential
          const lldpNeighbors = await discoverLLDPNeighbors(gw.ip, cred.community);
          const vlans = await discoverVLANs(gw.ip, cred.community);
          return { macTable, lldpNeighbors, vlans };
        });
        if (result) snmpResults[gw.ip] = result;
      }
```

Pass snmpResults to buildTopology.

- [ ] **Step 3: Update server.js to wire credentialManager and blacklist**

Add to server.js:
```js
import { CredentialManager, Blacklist } from "./src/security.js";

const credentialManager = new CredentialManager();
const blacklist = new Blacklist();
// Initialize defaults
credentialManager.addSnmpV2("public");
credentialManager.addSnmpV2("private");
```

Update registerTools call:
```js
registerTools(server, { getScanState, setScanState, credentialManager, blacklist });
```

- [ ] **Step 4: Update tests**

Update topology-builder test to verify device classification and boundary detection on sample data.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/topology-builder.js src/mcp/tools.js server.js test/
git commit -m "feat: integrate device roles, boundaries, SNMP discovery, and credentials into topology pipeline"
```

---

### Task 17: Enhance Web UI — Device Roles + Boundaries

**Files:**
- Modify: `@aipy-pro/net-topology/src/ui/app.js`

**Produces:** UI renders device-specific icons/colors, shows boundary indicators, displays role in detail panel.

- [ ] **Step 1: Update node style in app.js**

Add more Cytoscape styles for classified device types:
```js
{ selector: 'node[type="router"]', style: { "background-color": "#e8710a", width: 36, height: 36, "font-size": "11px", "font-weight": "bold" } },
{ selector: 'node[type="switch"]', style: { "background-color": "#1a73e8", width: 32, height: 32 } },
{ selector: 'node[type="firewall"]', style: { "background-color": "#ea4335", width: 32, height: 32, "shape": "rectangle" } },
{ selector: 'node[type="gateway"]', style: { "background-color": "#e8710a", width: 30, height: 30 } },
```

- [ ] **Step 2: Add boundary edges**

```js
{ selector: 'edge[type="vlan_boundary"]', style: { "line-color": "#fbbc04", "target-arrow-color": "#fbbc04", "line-style": "dashed", "width": 2 } },
{ selector: 'edge[type="nat_boundary"]', style: { "line-color": "#ea4335", "target-arrow-color": "#ea4335", "line-style": "dashed", "width": 2, "arrow-scale": 1.5 } },
```

- [ ] **Step 3: Update renderTopology to show boundaries**

After adding nodes and edges, add boundary visualization:
```js
  // Add boundary indicators as dashed edges between related gateways
  for (const b of (data.boundaries || [])) {
    if (b.type === "vlan" && b.gatewayId) {
      const otherGateway = data.topology.nodes.find(
        n => n.mac === b.gatewayMac && n.id !== b.gatewayId
      );
      if (otherGateway) {
        elements.push({
          group: "edges",
          data: {
            id: `boundary_${b.gatewayId}_${otherGateway.id}`,
            source: b.gatewayId, target: otherGateway.id,
            type: "vlan_boundary",
            label: `VLAN ${b.vlanId || ""}`,
          },
        });
      }
    }
  }
```

- [ ] **Step 4: Update detail panel to show device role + confidence**

Add type/confidence fields to the detail panel:
```js
  ["角色", `${data.type || "unknown"} (${Math.round((data.roleConfidence || 0) * 100)}%)`],
```

- [ ] **Step 5: Update legend**

```html
<span class="legend-item"><span class="dot firewall"></span> 防火墙</span>
```

```css
.dot.firewall { background: #ea4335; }
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.js src/ui/styles.css src/ui/index.html
git commit -m "feat: UI device role colors, boundary edges, and firewall legend"
```

---

### Task 18: Phase 2 Integration Test

**Files:**
- Create: `@aipy-pro/net-topology/test/integration/phase2.test.js`

**Produces:** End-to-end test verifying device classification, boundary detection, credential management.

- [ ] **Step 1: Write integration test**

```js
import { describe, it } from "node:test";
import assert from "node:assert";
import { identifyDeviceRole } from "../../src/analyzer/device-role.js";
import { detectBoundaries } from "../../src/analyzer/boundary-detector.js";
import { buildTopology } from "../../src/analyzer/topology-builder.js";
import { CredentialManager, Blacklist } from "../../src/security.js";
import { lookupVendor } from "../../src/analyzer/heuristics.js";

describe("Phase 2 integration", () => {
  it("classifies multi-homed device as router in full pipeline", () => {
    const hosts = [
      { ip: "192.168.1.1", mac: "00:00:0c:aa:bb:cc", status: "up", isGateway: true, subnet: "192.168.1.0/24" },
      { ip: "10.0.0.1", mac: "00:00:0c:aa:bb:cc", status: "up", isGateway: true, subnet: "10.0.0.0/24" },
      { ip: "192.168.1.100", mac: "dd:ee:ff:11:22:01", status: "up", isGateway: false, subnet: "192.168.1.0/24" },
    ];
    const topology = buildTopology({ hosts, hostDetails: [], traces: [], snmpResults: {} });
    const routers = topology.topology.nodes.filter(n => n.type === "router");
    assert.ok(routers.length >= 1, "should classify multi-homed device as router");
    assert.ok(topology.boundaries.length > 0, "should detect VLAN boundary");
  });

  it("credential manager privacy works", () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("mySecretCommunity");
    const json = JSON.stringify(cm);
    assert.ok(!json.includes("mySecretCommunity"), "credentials must not be serialized");
  });

  it("blacklist blocks CIDR subnets", () => {
    const bl = new Blacklist();
    bl.add("192.168.100.0/24");
    assert.equal(bl.isBlocked("192.168.100.50"), true);
    assert.equal(bl.isBlocked("192.168.1.50"), false);
  });

  it("OUI lookup identifies known vendor", () => {
    assert.equal(lookupVendor("00:00:0c:11:22:33"), "Cisco Systems");
    assert.equal(lookupVendor("zz:zz:zz:11:22:33"), null);
  });
});
```

- [ ] **Step 2: Run test — expected PASS**

```bash
node --test test/integration/phase2.test.js
```

- [ ] **Step 3: Run all tests**

```bash
cd @aipy-pro/net-topology && node --test test/**/*.test.js
```

- [ ] **Step 4: Commit**

```bash
git add test/integration/phase2.test.js
git commit -m "test: Phase 2 integration — device roles, boundaries, credentials, blacklist"
```

---

## Phase 2 Complete — Verification

```bash
cd @aipy-pro/net-topology && node --test test/**/*.test.js
# Expected: all suites pass

timeout 3 node server.js || true
# Expected: prints MCP server listening on port <N>
```
