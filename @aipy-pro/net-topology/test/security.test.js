import { describe, it } from "node:test";
import assert from "node:assert";
import { CredentialManager, Blacklist } from "../src/security.js";

describe("CredentialManager", () => {
  it("stores and retrieves SNMP credentials", () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("public"); cm.addSnmpV2("private");
    assert.equal(cm.getSnmpCredentials().length, 2);
    assert.equal(cm.getSnmpCredentials()[0].community, "public");
    assert.equal(cm.getSnmpCredentials()[1].community, "private");
  });

  it("trySnmpCredentials iterates all", async () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("public"); cm.addSnmpV2("private");
    const results = [];
    await cm.trySnmpCredentials("192.0.2.1", async (cred) => { results.push(cred.community); return null; });
    assert.deepEqual(results, ["public", "private"]);
  });

  it("credentials not serialized to JSON", () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("secret123");
    assert.ok(!JSON.stringify(cm).includes("secret123"));
  });

  it("clear removes all", () => {
    const cm = new CredentialManager();
    cm.addSnmpV2("public"); cm.clear();
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
    bl.add("192.168.1.100"); bl.remove("192.168.1.100");
    assert.equal(bl.isBlocked("192.168.1.100"), false);
  });
});
