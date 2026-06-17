import { describe, it } from "node:test";
import assert from "node:assert";
import { detectBoundaries } from "../../src/analyzer/boundary-detector.js";

describe("detectBoundaries", () => {
  it("returns array", () => {
    const r = detectBoundaries([], [], [], null);
    assert.ok(Array.isArray(r));
  });

  it("detects VLAN when same MAC on different subnets", () => {
    const nodes = [
      { id: "192.168.1.1", subnet: "192.168.1.0/24", isGateway: true, type: "router", mac: "00:00:0c:11:22:01" },
      { id: "10.0.0.1", subnet: "10.0.0.0/24", isGateway: true, type: "router", mac: "00:00:0c:11:22:01" },
    ];
    const r = detectBoundaries(nodes, [], ["192.168.1.0/24", "10.0.0.0/24"], null);
    assert.ok(r.filter(b => b.type === "vlan").length > 0);
  });

  it("detects NAT with external IP", () => {
    const nodes = [{ id: "192.168.1.254", subnet: "192.168.1.0/24", isGateway: true, type: "router", mac: "aa:bb:cc:dd:ee:ff" }];
    const r = detectBoundaries(nodes, [], ["192.168.1.0/24"], "203.0.113.5");
    const nat = r.filter(b => b.type === "nat");
    assert.equal(nat.length, 1);
    assert.equal(nat[0].externalIp, "203.0.113.5");
  });

  it("returns empty for single-subnet", () => {
    const nodes = [
      { id: "192.168.1.1", subnet: "192.168.1.0/24", isGateway: true, type: "gateway", mac: "aa:bb:cc:dd:ee:01" },
      { id: "192.168.1.100", subnet: "192.168.1.0/24", isGateway: false, type: "endpoint", mac: "aa:bb:cc:dd:ee:02" },
    ];
    assert.equal(detectBoundaries(nodes, [], ["192.168.1.0/24"], null).length, 0);
  });
});
