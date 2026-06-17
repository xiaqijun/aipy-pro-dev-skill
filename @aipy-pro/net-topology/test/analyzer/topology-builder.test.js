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
