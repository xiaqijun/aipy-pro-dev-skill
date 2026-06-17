import snmp from "snmp-native";

export const OIDS = {
  sysDescr:        [1, 3, 6, 1, 2, 1, 1, 1, 0],
  sysName:         [1, 3, 6, 1, 2, 1, 1, 5, 0],
  ipRouteTable:    [1, 3, 6, 1, 2, 1, 4, 21],
  dot1dTpFdbTable: [1, 3, 6, 1, 2, 1, 17, 4, 3],
  lldpRemTable:    [1, 0, 8802, 1, 1, 2, 1, 4],
  lldpRemPortId:   [1, 0, 8802, 1, 1, 2, 1, 4, 1, 2],
  lldpRemSysName:  [1, 0, 8802, 1, 1, 2, 1, 4, 1, 4],
  vlanTable:       [1, 3, 6, 1, 2, 1, 17, 7, 1, 4, 2, 1, 3],
};

export async function snmpGet(ip, community, oids, opts = {}) {
  const { timeout = 3000 } = opts;
  return new Promise((resolve) => {
    const session = new snmp.Session({ host: ip, community, timeouts: [timeout] });
    let responded = false;
    session.get({ oids }, (err, varbinds) => {
      if (responded) return;
      responded = true;
      session.close();
      if (err) { resolve(null); return; }
      const results = {};
      for (const vb of varbinds) {
        if (vb.value !== undefined) results[vb.oid.join(".")] = vb.value;
      }
      resolve(Object.keys(results).length > 0 ? results : null);
    });
    setTimeout(() => { if (!responded) { responded = true; session.close(); resolve(null); } }, timeout);
  });
}

export async function snmpWalk(ip, community, baseOid, opts = {}) {
  const { timeout = 5000, maxVarbinds = 500 } = opts;
  return new Promise((resolve) => {
    const session = new snmp.Session({ host: ip, community, timeouts: [timeout] });
    let responded = false;
    const done = (result) => { if (!responded) { responded = true; session.close(); resolve(result); } };
    function walk(oid) {
      session.getSubtree({ oid, combinedTimeout: timeout }, (err, varbinds) => {
        if (responded) return;
        if (err || !varbinds || varbinds.length === 0) { done([]); return; }
        for (const vb of varbinds) {
          results.push({ oid: vb.oid.join("."), value: vb.value });
          if (results.length >= maxVarbinds) { done(results); return; }
        }
        done(results);
      });
    }
    const results = [];
    walk(baseOid);
    setTimeout(() => done(results), timeout);
  });
}

export async function discoverSwitchPorts(ip, community) {
  const entries = await snmpWalk(ip, community, OIDS.dot1dTpFdbTable);
  const macByPort = {};
  for (const e of entries) {
    const parts = e.oid.split(".");
    const port = parts[parts.length - 1];
    const mac = typeof e.value === "string" ? e.value : formatMac(e.value);
    if (!macByPort[port]) macByPort[port] = [];
    macByPort[port].push(mac);
  }
  return macByPort;
}

export async function discoverLLDPNeighbors(ip, community) {
  const entries = await snmpWalk(ip, community, OIDS.lldpRemTable);
  const neighbors = [];
  const current = {};
  for (const e of entries) {
    if (e.oid.includes(OIDS.lldpRemSysName.join("."))) current.sysName = String(e.value);
    if (e.oid.includes(OIDS.lldpRemPortId.join("."))) {
      current.portId = String(e.value);
      neighbors.push({ sysName: current.sysName || "unknown", portId: current.portId });
    }
  }
  return neighbors;
}

export async function discoverVLANs(ip, community) {
  const entries = await snmpWalk(ip, community, OIDS.vlanTable);
  const vlanIds = new Set();
  for (const e of entries) {
    const parts = e.oid.split(".");
    const vlanId = parseInt(parts[parts.length - 1]);
    if (!isNaN(vlanId)) vlanIds.add(vlanId);
  }
  return Array.from(vlanIds).map(id => ({ vlanId: id }));
}

function formatMac(value) {
  if (Buffer.isBuffer(value)) return Array.from(value).map(b => b.toString(16).padStart(2, "0")).join(":");
  return String(value);
}
