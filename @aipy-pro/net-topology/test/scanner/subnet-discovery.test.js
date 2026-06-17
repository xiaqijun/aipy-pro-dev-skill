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
