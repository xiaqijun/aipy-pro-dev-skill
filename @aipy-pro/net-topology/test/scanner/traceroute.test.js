import { describe, it } from "node:test";
import assert from "node:assert";
import { traceRoute } from "../../src/scanner/traceroute.js";

describe("traceRoute", () => {
  it("returns array of hop objects", async () => {
    const hops = await traceRoute("127.0.0.1");
    assert.ok(Array.isArray(hops));
    for (const h of hops) {
      assert.ok(typeof h.hop === "number");
      assert.ok(typeof h.ip === "string");
    }
  });
});
