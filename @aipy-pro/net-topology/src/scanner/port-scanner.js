import { execSync, exec } from "child_process";
import { promisify } from "util";
import net from "net";
import { RateLimiter } from "./rate-limiter.js";

const execP = promisify(exec);

const WELL_KNOWN = {
  21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
  80: "http", 110: "pop3", 143: "imap", 161: "snmp", 179: "bgp",
  389: "ldap", 443: "https", 445: "smb", 465: "smtps", 514: "syslog",
  520: "rip", 587: "smtp", 636: "ldaps", 993: "imaps", 995: "pop3s",
  1433: "mssql", 1521: "oracle", 3306: "mysql", 3389: "rdp",
  5432: "postgresql", 6379: "redis", 8080: "http-proxy", 8443: "https-alt",
  9090: "websphere", 9200: "elasticsearch", 27017: "mongodb",
};

function hasNmap() {
  try { execSync("nmap --version", { encoding: "utf8", timeout: 3000 }); return true; }
  catch { return false; }
}

async function scanWithNmap(ip, portRange) {
  try {
    const cmd = `nmap -sS -sV -O -p ${portRange} --host-timeout 30s -T4 -oX - ${ip}`;
    const { stdout } = await execP(cmd, { timeout: 60000 });
    return parseNmapXml(stdout);
  } catch (err) {
    throw new Error(`nmap scan failed: ${err.message}`);
  }
}

function parseNmapXml(xml) {
  const result = { ip: "", mac: null, hostname: "", os: "", ports: [], scanMethod: "nmap" };
  const addrMatch = xml.match(/<address addr="([^"]+)" addrtype="ipv4"/);
  if (addrMatch) result.ip = addrMatch[1];
  const macMatch = xml.match(/<address addr="([^"]+)" addrtype="mac"/);
  if (macMatch) result.mac = macMatch[1].toLowerCase();
  const hostMatch = xml.match(/<hostname name="([^"]+)"/);
  if (hostMatch) result.hostname = hostMatch[1];
  const osMatch = xml.match(/<osmatch name="([^"]+)" accuracy="(\d+)"/);
  if (osMatch) result.os = osMatch[1];
  const portRegex = /<port protocol="tcp" portid="(\d+)">[\s\S]*?<state state="(\w+)"[\s\S]*?<service name="([^"]*)"(?:\s+product="([^"]*)")?(?:\s+version="([^"]*)")?/g;
  let m;
  while ((m = portRegex.exec(xml)) !== null) {
    if (m[2] === "open") {
      result.ports.push({ port: parseInt(m[1]), service: m[3] || "unknown", version: m[5] || m[4] || null });
    }
  }
  return result;
}

async function scanNative(ip, portRange) {
  const result = { ip, mac: null, hostname: "", os: "", ports: [], scanMethod: "native" };
  const [start, end] = portRange.split("-").map(Number);
  const endPort = end || start;
  const limiter = new RateLimiter();
  const promises = [];
  for (let port = start; port <= endPort; port++) {
    promises.push((async () => {
      const release = await limiter.acquire("tcp");
      try {
        const open = await checkPort(ip, port);
        if (open) result.ports.push({ port, service: WELL_KNOWN[port] || "unknown", version: null });
      } finally { release(); }
    })());
  }
  await Promise.all(promises);
  result.ports.sort((a, b) => a.port - b.port);
  return result;
}

function checkPort(ip, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, ip);
  });
}

export async function scanHost(ip, opts = {}) {
  const { portRange = "1-1000" } = opts;
  if (hasNmap()) {
    try { return await scanWithNmap(ip, portRange); }
    catch { /* fall through to native */ }
  }
  return await scanNative(ip, portRange);
}
