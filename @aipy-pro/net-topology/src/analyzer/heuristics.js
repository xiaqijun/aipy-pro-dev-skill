export const OUI_VENDORS = {
  "00000c": "Cisco Systems", "001a30": "Juniper Networks", "00095b": "Netgear",
  "001b17": "Palo Alto Networks", "00090f": "Fortinet", "001c7e": "Check Point",
  "0050ba": "D-Link", "0017a4": "Hewlett Packard Enterprise", "3c8c40": "Huawei Technologies",
  "74882a": "H3C Technologies", "001018": "Broadcom", "40a6e8": "Aruba Networks",
  "f09fc2": "Ubiquiti Networks", "001256": "Dell", "b8ca3a": "Dell",
  "e02f6d": "Cisco Meraki", "88f077": "Cisco Meraki", "ac86c9": "MikroTik",
  "2c9e5f": "Arista Networks", "001c73": "Arista Networks",
};

export const ROUTER_PORTS = [179, 520, 521, 1985];
export const FIREWALL_PORTS = [8443, 10443];
export const MGMT_PORTS = [22, 23, 80, 161, 443];

export const PRIVATE_RANGES = [
  { network: [10, 0, 0, 0], prefix: 8 },
  { network: [172, 16, 0, 0], prefix: 12 },
  { network: [192, 168, 0, 0], prefix: 16 },
];

export function lookupVendor(mac) {
  if (!mac) return null;
  const prefix = mac.replace(/[:\-]/g, "").substring(0, 6).toLowerCase();
  return OUI_VENDORS[prefix] || null;
}

export function isNetworkVendor(mac) { return lookupVendor(mac) !== null; }

export function ipToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
}

export function isPrivate(ip) {
  const int = ipToInt(ip);
  for (const range of PRIVATE_RANGES) {
    const netInt = range.network.reduce((a, o) => (a << 8) + o, 0) >>> 0;
    if (((int & ((~0) << (32 - range.prefix))) >>> 0) === netInt) return true;
  }
  return false;
}

export function isIpInSubnet(ip, cidr) {
  const [net, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr);
  return (ipToInt(ip) & ((~0) << (32 - prefix))) === (ipToInt(net) & ((~0) << (32 - prefix)));
}
