import { describe, it } from "node:test";
import assert from "node:assert";
import { scanHost } from "../../src/scanner/port-scanner.js";

describe("scanHost", () => {
  it("returns host scan result with ports array", async () => {
    const result = await scanHost("127.0.0.1", { portRange: "22" });
    assert.ok(typeof result.ip === "string");
    assert.ok(Array.isArray(result.ports));
  });

  it("detects scan method", async () => {
    const result = await scanHost("127.0.0.1", { portRange: "80" });
    assert.ok(result.scanMethod === "nmap" || result.scanMethod === "native");
  });
});
