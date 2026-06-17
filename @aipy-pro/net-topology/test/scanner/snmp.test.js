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
