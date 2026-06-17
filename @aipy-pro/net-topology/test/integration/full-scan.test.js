import { describe, it } from "node:test";
import assert from "node:assert";
import { discoverSubnets } from "../../src/scanner/subnet-discovery.js";
import { discoverHosts } from "../../src/scanner/host-discovery.js";
import { scanHost } from "../../src/scanner/port-scanner.js";
import { buildTopology } from "../../src/analyzer/topology-builder.js";

describe("full_scan integration", () => {
  it("completes full pipeline for localhost", async () => {
    const subnets = await discoverSubnets({ includeHeuristic: false });
    assert.ok(subnets.length > 0, "should find at least one subnet");

    const privateSubnet = subnets.find(s =>
      s.subnet.startsWith("192.168.") || s.subnet.startsWith("10.") || s.subnet.startsWith("172.")
    );
    if (!privateSubnet) { console.log("Skipping — no private subnet to scan"); return; }

    const hosts = await discoverHosts(privateSubnet.subnet);
    assert.ok(hosts.length > 0, `should find hosts on ${privateSubnet.subnet}`);

    if (hosts.length > 0) {
      const detail = await scanHost(hosts[0].ip, { portRange: "22,80,443" });
      assert.ok(detail.ip === hosts[0].ip);
      assert.ok(Array.isArray(detail.ports));
    }

    const topology = buildTopology({ hosts, hostDetails: [], traces: [] });
    assert.ok(topology.topology.nodes.length > 0);
    assert.ok(topology.statistics.hostsFound > 0);
  });

  it("topology JSON matches schema", () => {
    const topology = buildTopology({
      hosts: [{ ip: "10.0.0.1", mac: "00:00:0c:aa:bb:cc", status: "up", isGateway: true, subnet: "10.0.0.0/24" }],
      hostDetails: [], traces: [],
    });
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
