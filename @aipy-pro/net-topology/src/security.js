import { isIpInSubnet } from "./analyzer/heuristics.js";

export class CredentialManager {
  #snmpV2 = [];
  #snmpV3 = [];
  #sshCredentials = [];

  addSnmpV2(community) { this.#snmpV2.push({ type: "v2c", community }); }
  addSnmpV3(username, authProtocol, authPassword, privacyProtocol, privacyPassword) {
    this.#snmpV3.push({ type: "v3", username, authProtocol, authPassword, privacyProtocol, privacyPassword });
  }
  addSSH(username, password, privateKey) { this.#sshCredentials.push({ type: "ssh", username, password, privateKey }); }

  getSnmpCredentials() { return [...this.#snmpV2, ...this.#snmpV3]; }
  getSSHCredentials() { return [...this.#sshCredentials]; }

  async trySnmpCredentials(ip, fn) {
    for (const cred of this.getSnmpCredentials()) {
      try { const result = await fn(cred); if (result !== null) return result; }
      catch { /* next */ }
    }
    return null;
  }

  clear() { this.#snmpV2 = []; this.#snmpV3 = []; this.#sshCredentials = []; }

  toJSON() {
    return { snmpV2Count: this.#snmpV2.length, snmpV3Count: this.#snmpV3.length, sshCount: this.#sshCredentials.length };
  }
}

export class Blacklist {
  #entries = [];

  add(target) {
    if (target.includes("/")) {
      const [net, prefix] = target.split("/");
      this.#entries.push({ type: "cidr", value: target, cidrNet: net, cidrPrefix: parseInt(prefix) });
    } else {
      this.#entries.push({ type: "ip", value: target });
    }
  }

  remove(target) { this.#entries = this.#entries.filter(e => e.value !== target); }

  isBlocked(ip) {
    for (const e of this.#entries) {
      if (e.type === "ip" && e.value === ip) return true;
      if (e.type === "cidr" && isIpInSubnet(ip, e.value)) return true;
    }
    return false;
  }

  toList() { return this.#entries.map(e => e.value); }
  clear() { this.#entries = []; }
}
