import { describe, it } from "node:test";
import assert from "node:assert";
import { identifyDeviceRole } from "../../src/analyzer/device-role.js";

describe("identifyDeviceRole", () => {
  const basicHost = { ip: "192.168.1.100", mac: "aa:bb:cc:dd:ee:01", ports: [], status: "up" };

  it("identifies endpoint for basic host", () => {
    const r = identifyDeviceRole("192.168.1.100", basicHost, [], [], null);
    assert.equal(r.type, "endpoint");
    assert.ok(r.confidence >= 0.5);
  });

  it("identifies router by multi-homed MAC", () => {
    const hosts = [
      { ip: "192.168.1.1", mac: "00:00:0c:11:22:01", subnet: "192.168.1.0/24", ports: [] },
      { ip: "10.0.0.1", mac: "00:00:0c:11:22:01", subnet: "10.0.0.0/24", ports: [] },
    ];
    const r = identifyDeviceRole("192.168.1.1", hosts[0], hosts, [], null);
    assert.equal(r.type, "router");
    assert.ok(r.confidence >= 0.8);
    assert.ok(r.reasons.some(x => x.includes("multi-homed")));
  });

  it("identifies router by traceroute hop", () => {
    const traces = [{ target: "10.0.0.5", hops: [{ hop: 1, ip: "192.168.1.1" }, { hop: 2, ip: "10.0.0.5" }] }];
    const r = identifyDeviceRole("192.168.1.1", basicHost, [basicHost], traces, null);
    assert.equal(r.type, "router");
    assert.ok(r.reasons.some(x => x.includes("traceroute hop")));
  });

  it("identifies router by BGP port", () => {
    const host = { ...basicHost, ip: "10.0.0.1", ports: [{ port: 179, service: "bgp" }] };
    assert.equal(identifyDeviceRole("10.0.0.1", host, [host], [], null).type, "router");
  });

  it("identifies switch by SNMP MAC table", () => {
    const snmp = { macTable: { "1": ["aa:bb:cc:11:22:01"], "2": ["aa:bb:cc:11:22:02"] } };
    const r = identifyDeviceRole("192.168.1.2", basicHost, [basicHost], [], snmp);
    assert.equal(r.type, "switch");
    assert.ok(r.confidence >= 0.8);
  });

  it("identifies firewall by port pattern", () => {
    const host = { ...basicHost, ports: [{ port: 443 }, { port: 8443 }, { port: 22 }] };
    assert.equal(identifyDeviceRole("10.0.0.254", host, [host], [], null).type, "firewall");
  });
});
