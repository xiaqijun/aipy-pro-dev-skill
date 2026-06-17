import { exec } from "child_process";
import { promisify } from "util";
const execP = promisify(exec);

export async function traceRoute(target, opts = {}) {
  const { maxHops = 30, timeout = 30000 } = opts;
  const isWindows = process.platform === "win32";
  try {
    const cmd = isWindows
      ? `tracert -d -h ${maxHops} ${target}`
      : `traceroute -n -m ${maxHops} -w 1 ${target} 2>/dev/null || traceroute -n ${target}`;
    const { stdout } = await execP(cmd, { timeout, shell: true });
    return parseTraceroute(stdout, isWindows);
  } catch (err) {
    if (err.stdout) return parseTraceroute(err.stdout, isWindows);
    return [];
  }
}

function parseTraceroute(output, isWindows) {
  const hops = [];
  const lines = output.split("\n");
  for (const line of lines) {
    if (isWindows) {
      const m = line.match(/^\s*(\d+)\s+.+?(\d+\.\d+\.\d+\.\d+)/);
      if (m) hops.push({ hop: parseInt(m[1]), ip: m[2], rtt: null });
    } else {
      const m = line.match(/^\s*(\d+)\s+(\d+\.\d+\.\d+\.\d+)/);
      if (m) {
        const rttMatch = line.match(/([\d.]+)\s*ms/);
        hops.push({ hop: parseInt(m[1]), ip: m[2], rtt: rttMatch ? parseFloat(rttMatch[1]) : null });
      }
    }
  }
  return hops;
}
