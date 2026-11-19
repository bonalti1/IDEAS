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
    count: (key) => map.set(key, [...live(key), now()]),
    prune() {
      for (const k of [...map.keys()]) live(k)
      return map.size
    },
    size: () => map.size,
  }
}
