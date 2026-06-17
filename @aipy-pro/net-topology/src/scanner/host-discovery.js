import { execSync, exec } from "child_process";
import { promisify } from "util";
import { RateLimiter } from "./rate-limiter.js";

const execP = promisify(exec);

const OUI_MAP = {
  "00000c": "Cisco Systems", "001a30": "Juniper Networks", "00095b": "Netgear",
  "001b17": "Palo Alto Networks", "00090f": "Fortinet", "001c7e": "Check Point",
  "0050ba": "D-Link", "0017a4": "Hewlett Packard", "3c8c40": "Huawei Technologies",
  "74882a": "H3C Technologies",
};

function lookupOUI(mac) {
  if (!mac) return null;
  const prefix = mac.replace(/[:\-]/g, "").substring(0, 6).toLowerCase();
  return OUI_MAP[prefix] || null;
}

async function pingHost(ip) {
  try {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? `ping -n 1 -w 500 ${ip}` : `ping -c 1 -W 1 ${ip}`;
    await execP(cmd, { timeout: 2000 });
    return true;
  } catch { return false; }
}

async function arpScan(subnet) {
  const hosts = [];
  try {
    const isWindows = process.platform === "win32";
    let output;
    if (isWindows) {
      output = execSync(`arp -a`, { encoding: "utf8", timeout: 10000 });
    } else {
      try {
        output = execSync(`arp-scan --localnet 2>/dev/null || arp -a -n`, {
          encoding: "utf8", timeout: 15000, shell: true,
        });
      } catch {
        output = execSync(`arp -a -n 2>/dev/null || arp -a`, {
          encoding: "utf8", timeout: 10000, shell: true,
        });
      }
    }
    const lines = output.split("\n");
    for (const line of lines) {
      const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+)/);
      const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
      if (ipMatch) {
        const ip = ipMatch[1];
        const mac = macMatch ? macMatch[0].toLowerCase() : null;
        if (isIpInSubnet(ip, subnet)) {
          hosts.push({ ip, mac, vendor: lookupOUI(mac), status: "up", isGateway: false });
        }
      }
    }
  } catch { /* fall through to ICMP */ }
  return hosts;
}

function isIpInSubnet(ip, cidr) {
  const [net, prefix] = cidr.split("/");
  const p = parseInt(prefix);
  const ipInt = ip.split(".").reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0;
  const netInt = net.split(".").reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0;
  const mask = (~0) << (32 - p);
  return (ipInt & mask) === (netInt & mask);
}

function* subnetIps(cidr) {
  const [net, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr);
  if (prefix > 30) { yield net; return; }
  const netParts = net.split(".").map(Number);
  const netInt = netParts.reduce((a, o) => (a << 8) + o, 0) >>> 0;
  const count = 1 << (32 - prefix);
  const maxHosts = Math.min(count - 2, 256);
  for (let i = 1; i <= maxHosts; i++) {
    const ipInt = (netInt + i) >>> 0;
    yield `${(ipInt >> 24) & 0xff}.${(ipInt >> 16) & 0xff}.${(ipInt >> 8) & 0xff}.${ipInt & 0xff}`;
  }
}

export async function discoverHosts(subnet, opts = {}) {
  const limiter = new RateLimiter(opts);
  const hostsByIp = new Map();

  try {
    const arpHosts = await arpScan(subnet);
    for (const h of arpHosts) { hostsByIp.set(h.ip, h); }
  } catch { /* continue with ICMP */ }

  const ips = Array.from(subnetIps(subnet));
  const promises = ips.map(async (ip) => {
    if (hostsByIp.has(ip)) return;
    const release = await limiter.acquire("icmp");
    try {
      const alive = await pingHost(ip);
      limiter.report(alive);
      if (alive) {
        hostsByIp.set(ip, { ip, mac: null, vendor: null, status: "up", isGateway: false });
      }
    } finally { release(); }
  });
  await Promise.all(promises);

  const [net] = subnet.split("/");
  const netParts = net.split(".").map(Number);
  const gatewayIp = `${netParts[0]}.${netParts[1]}.${netParts[2]}.1`;

  return Array.from(hostsByIp.values()).map(h => ({
    ...h, isGateway: h.ip === gatewayIp,
  }));
}
