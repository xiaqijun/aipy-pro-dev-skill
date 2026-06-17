const DEFAULTS = {
  maxConcurrent: 20,
  arpIntervalMs: 50,
  icmpIntervalMs: 100,
  tcpPps: 50,
  perHostMaxPortsPerSec: 100,
  perHostMaxConcurrent: 10,
  backoffFactor: 0.5,
  maxRetries: 2,
};

export class RateLimiter {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this._running = 0;
    this._consecutiveFailures = 0;
  }

  async acquire(type = "tcp") {
    while (this._running >= this.opts.maxConcurrent) {
      await sleep(10);
    }
    const interval = type === "arp" ? this.opts.arpIntervalMs
      : type === "icmp" ? this.opts.icmpIntervalMs
      : 1000 / this.opts.tcpPps;
    await sleep(interval);
    this._running++;
    return () => { this._running--; };
  }

  report(success) {
    if (!success) {
      this._consecutiveFailures++;
    } else {
      this._consecutiveFailures = Math.max(0, this._consecutiveFailures - 1);
    }
  }

  get throttleFactor() {
    if (this._consecutiveFailures >= 5) return this.opts.backoffFactor; // 0.5
    if (this._consecutiveFailures >= 3) return 0.75;
    return 1.0;
  }

  get currentRate() {
    return Math.floor(this.opts.tcpPps * this.throttleFactor);
  }

  get retries() {
    return this._consecutiveFailures >= 5 ? 1 : this.opts.maxRetries;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
