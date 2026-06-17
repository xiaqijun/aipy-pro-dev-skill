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
    assert.ok(topology.statistics.routers >= 1);
    assert.ok(topology.statistics.boundariesFound >= 1);
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

  it("boundary detector finds firewall from classified nodes", () => {
    const nodes = [
      { id: "10.0.0.254", subnet: "10.0.0.0/24", type: "firewall", roleConfidence: 0.75, mac: "00:1b:17:aa:bb:cc" },
    ];
    const bounds = detectBoundaries(nodes, [], ["10.0.0.0/24"], null);
    const fw = bounds.filter(b => b.type === "firewall");
    assert.equal(fw.length, 1);
    assert.equal(fw[0].deviceId, "10.0.0.254");
  });
});
