import { execSync } from "child_process";

const PRIVATE_RANGES = [
  { network: [10, 0, 0, 0], prefix: 8 },
  { network: [172, 16, 0, 0], prefix: 12 },
  { network: [192, 168, 0, 0], prefix: 16 },
];

function ipToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
}

function isPrivate(ip) {
  const int = ipToInt(ip);
  for (const range of PRIVATE_RANGES) {
    const netInt = range.network.reduce((a, o) => (a << 8) + o, 0) >>> 0;
    const mask = (~0) << (32 - range.prefix);
    if ((int & mask) === (netInt & mask)) return true;
  }
  return false;
}

function netmaskToCIDR(ip, netmask) {
  const maskParts = netmask.split(".").map(Number);
  const maskInt = maskParts.reduce((a, o) => (a << 8) + o, 0) >>> 0;
  if (maskInt === 0) return null;
  // Count consecutive 1 bits from MSB
  let prefix = 0;
  let m = maskInt;
  while (m & 0x80000000) { prefix++; m <<= 1; }
  if (((~0) << (32 - prefix)) !== maskInt) return null; // non-contiguous mask
  return `${ip}/${prefix}`;
}

function discoverFromRouteTable() {
  const subnets = [];
  try {
    const isWindows = process.platform === "win32";
    let output;
    if (isWindows) {
      output = execSync("route print -4", { encoding: "utf8", timeout: 5000 });
    } else {
      output = execSync("ip route show 2>/dev/null || route -n", { encoding: "utf8", timeout: 5000, shell: true });
    }
    const lines = output.split("\n");

    if (isWindows) {
      // Windows: "0.0.0.0   0.0.0.0   192.168.1.254   192.168.1.100   25"
      // Columns: Network Destination, Netmask, Gateway, Interface, Metric
      // Skip header lines, look for dotted-quad pairs
      for (const line of lines) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 4) {
          const dest = cols[0];
          const netmask = cols[1];
          if (/^\d+\.\d+\.\d+\.\d+$/.test(dest) && /^\d+\.\d+\.\d+\.\d+$/.test(netmask)) {
            if (dest === "0.0.0.0") continue;
            if (dest === "127.0.0.0") continue;
            const cidr = netmaskToCIDR(dest, netmask);
            if (cidr && isPrivate(dest)) {
              const gateway = cols[2] && cols[2] !== "0.0.0.0" ? cols[2] : null;
              subnets.push({ subnet: cidr, source: "route_table", gateway });
            }
          }
        }
      }
    } else {
      // Unix: look for CIDR in ip route or route -n output
      // "ip route": looks for "10.0.0.0/8"
      // "route -n": columns are Destination, Gateway, Genmask
      let hasCIDR = false;
      for (const line of lines) {
        const m = line.match(/(\d+\.\d+\.\d+\.\d+\/\d+)/);
        if (m) {
          hasCIDR = true;
          const cidr = m[1];
          const [ip] = cidr.split("/");
          if (cidr.startsWith("0.0.0.0")) continue;
          if (cidr === "127.0.0.0/8") continue;
          if (isPrivate(ip)) {
            const gatewayMatch = line.match(/via\s+(\d+\.\d+\.\d+\.\d+)/);
            subnets.push({ subnet: cidr, source: "route_table", gateway: gatewayMatch ? gatewayMatch[1] : null });
          }
        }
      }
      // Fallback: route -n columns
      if (!hasCIDR) {
        for (const line of lines) {
          const cols = line.trim().split(/\s+/);
          if (cols.length >= 3) {
            const dest = cols[0];
            const netmask = cols[2];
            if (/^\d+\.\d+\.\d+\.\d+$/.test(dest) && /^\d+\.\d+\.\d+\.\d+$/.test(netmask)) {
              if (dest === "0.0.0.0") continue;
              if (dest === "127.0.0.0") continue;
              const cidr = netmaskToCIDR(dest, netmask);
              if (cidr && isPrivate(dest)) {
                const gateway = cols[1] && cols[1] !== "0.0.0.0" ? cols[1] : null;
                subnets.push({ subnet: cidr, source: "route_table", gateway });
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("discoverFromRouteTable failed:", e.message);
  }
  return subnets;
}

function discoverFromArpCache() {
  const subnets = [];
  try {
    const isWindows = process.platform === "win32";
    const output = execSync(isWindows ? "arp -a" : "arp -a -n 2>/dev/null || arp -a", {
      encoding: "utf8", timeout: 5000, shell: true,
    });
    const ips = output.match(/\d+\.\d+\.\d+\.\d+/g) || [];
    const uniqueSubnets = new Set();
    for (const ip of ips) {
      if (!isPrivate(ip)) continue;
      const parts = ip.split(".").map(Number);
      const subnet24 = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      if (!uniqueSubnets.has(subnet24)) {
        uniqueSubnets.add(subnet24);
        subnets.push({ subnet: subnet24, source: "arp_cache", gateway: null });
      }
    }
  } catch (e) {
    console.error("discoverFromArpCache failed:", e.message);
  }
  return subnets;
}

function discoverHeuristic() {
  const subnets = [];
  const templates = [];
  for (let i = 0; i <= 10; i++) templates.push(`192.168.${i}.0/24`);
  for (let i = 0; i <= 10; i++) templates.push(`10.0.${i}.0/24`);
  for (let i = 0; i <= 5; i++) templates.push(`10.10.${i}.0/24`);
  templates.push("172.16.0.0/24", "172.16.1.0/24");
  for (const t of templates) {
    subnets.push({ subnet: t, source: "heuristic", gateway: null });
  }
  return subnets;
}

export async function discoverSubnets({ includeHeuristic = true } = {}) {
  let all = [];
  const fromRoute = discoverFromRouteTable();
  all = all.concat(fromRoute);
  const fromArp = discoverFromArpCache();
  all = all.concat(fromArp);
  if (includeHeuristic) {
    const fromHeuristic = discoverHeuristic();
    all = all.concat(fromHeuristic);
  }
  const seen = new Set();
  const result = [];
  for (const s of all) {
    if (!seen.has(s.subnet)) { seen.add(s.subnet); result.push(s); }
  }
  return result;
}
