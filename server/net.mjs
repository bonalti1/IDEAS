// The caller's address and the lookup limiter's bookkeeping (round 10, item 10), apart from the server so they can be tested.

/**
 * The caller's address. x-forwarded-for is a header anyone can send, so it is read only behind a proxy we know:
 * `hops` says how many proxies sit in front of this server (1 on Render), and the address is the one that many places
 * from the right, the entry the nearest trusted proxy wrote. 0 (the default): the socket's own address, header ignored.
 */
export function clientIp(req, hops = 0) {
  const socket = String(req.socket?.remoteAddress || '?').replace(/^::ffff:/, '')
  if (!hops) return socket
  const list = String(req.headers?.['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean)
  return list.length >= hops ? list[list.length - hops] : socket
}

/**
 * A sliding-window counter per key. left(key) is how many lookups the key has left in the window; count(key) records
 * one; prune() drops every key whose window is empty (a key nobody asks about again would otherwise stay for ever).
 */
export function makeWindow({ windowMs = 600000, limitFor = () => 20, now = () => Date.now() } = {}) {
  const map = new Map()
  const live = (key) => {
    const t = now()
    const list = (map.get(key) || []).filter((x) => t - x < windowMs)
    if (list.length) map.set(key, list)
    else map.delete(key)
    return list
  }
  return {
    left: (key) => limitFor(key) - live(key).length,
    /** Counts one now and returns its stamp, so a caller can give exactly that one back with release(). */
    count: (key) => {
      const t = now()
      map.set(key, [...live(key), t])
      return t
    },
    release: (key, stamp) => {
      const list = map.get(key) || []
      const i = list.lastIndexOf(stamp)
      if (i >= 0) list.splice(i, 1)
      if (!list.length) map.delete(key)
    },
    prune() {
      for (const k of [...map.keys()]) live(k)
      return map.size
    },
    size: () => map.size,
  }
}

// Cloudflare's published ranges (cloudflare.com/ips, read Nov 2026). Render's own load balancers reach the service
// from private addresses, which the private ranges below cover.
const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22']
const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10', '0.0.0.0/8']
const CLOUDFLARE_V6 = ['2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:', '2405:8100:', '2a06:98c', '2c0f:f248:']
const v4 = (ip) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  return m && m.slice(1).every((n) => +n <= 255) ? ((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | +m[4]) >>> 0 : null
}
const inCidr = (n, cidr) => {
  const [base, bits] = cidr.split('/')
  const mask = +bits === 0 ? 0 : (~0 << (32 - +bits)) >>> 0
  return ((n & mask) >>> 0) === ((v4(base) & mask) >>> 0)
}
/**
 * Is this an address many visitors share: a private or loopback address (a load balancer, a laptop), or one of
 * Cloudflare's? A per-address limit keyed on one of these would be shared by every homeowner at once, so the
 * limiter leaves the address key out for them and keeps the per-user key (round 11, item 3). Anything that is not
 * an address at all counts as shared too.
 */
export function isSharedAddress(ip) {
  const a = String(ip || '').trim().toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '')
  const n = v4(a)
  if (n != null) return PRIVATE_V4.some((c) => inCidr(n, c)) || CLOUDFLARE_V4.some((c) => inCidr(n, c))
  if (!a.includes(':')) return true
  if (a === '::1' || a === '::' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a)) return true
  return CLOUDFLARE_V6.some((p) => a.startsWith(p))
}
/**
 * What the proxy chain in front of this server looks like, in positions only (never an address): how many entries
 * X-Forwarded-For carries and which of them, counted from the right, equals CF-Connecting-IP (the visitor, as
 * Cloudflare saw them). That position is the right TRUST_PROXY_HOPS.
 */
export function proxyChain(req) {
  const list = String(req.headers?.['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean)
  const cf = String(req.headers?.['cf-connecting-ip'] || '').trim()
  const at = cf ? list.lastIndexOf(cf) : -1
  return { entries: list.length, cf: !!cf, cfFromRight: at >= 0 ? list.length - at : null }
}
export const proxyChainLine = (c, hops) =>
  `proxy chain: X-Forwarded-For has ${c.entries} entr${c.entries === 1 ? 'y' : 'ies'}; ${c.cf ? (c.cfFromRight ? `CF-Connecting-IP is entry ${c.cfFromRight} from the right` : 'CF-Connecting-IP is not among them') : 'no CF-Connecting-IP header'}; TRUST_PROXY_HOPS is ${hops}${c.cfFromRight && c.cfFromRight !== hops ? ` (set it to ${c.cfFromRight})` : c.cfFromRight ? ' (right)' : ''}`
