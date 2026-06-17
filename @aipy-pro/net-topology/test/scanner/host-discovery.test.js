import { describe, it } from "node:test";
import assert from "node:assert";
import { discoverHosts } from "../../src/scanner/host-discovery.js";

describe("discoverHosts", () => {
  it("returns array of host objects for localhost", async () => {
    const hosts = await discoverHosts("127.0.0.1/32");
    assert.ok(Array.isArray(hosts));
  });

  it("each host has required fields", async () => {
    const hosts = await discoverHosts("127.0.0.1/32");
    for (const h of hosts) {
      assert.ok(typeof h.ip === "string");
      assert.ok(typeof h.status === "string");
      assert.ok(["up", "down"].includes(h.status));
    }
  });
});
