/** assert Uint8Array[length]
  * @type {(a: Uint8Array, l?: number) => Uint8Array} */
export const au8 = (a, l) => {
  if (!(a instanceof Uint8Array) || (typeof l === 'number' && l > 0 && a.length !== l)) throw new Error(`Expected Uint8Array, received: ${a}`)
  else return a
}
export const toHex = (buf, limit = 0) => bytesToHex(limit ? buf.slice(0, limit) : buf)
export const fromHex = hexToBytes
const utf8Encoder = new globalThis.TextEncoder()
const utf8Decoder = new globalThis.TextDecoder()
export const s2b = s => utf8Encoder.encode(s)
export const b2s = b => utf8Decoder.decode(b)
export const cmp = (a, b, i = 0) => {
  if (au8(a).length !== au8(b).length) return false
  while (a[i] === b[i++]) if (i === a.length) return true
  return false
}
export const cpy = (to, from, offset = 0) => { to.set(from, offset); return to }
/** @returns {Uint8Array} */
export function toU8 (o) {
  if (o instanceof Uint8Array) return o
  if (o instanceof ArrayBuffer) return new Uint8Array(o)
  // node:Buffer to Uint8Array
  if (!(o instanceof Uint8Array) && o?.buffer) return new Uint8Array(o.buffer, o.byteOffset, o.byteLength)
  if (typeof o === 'string' && /^[a-f0-9]+$/i.test(o)) return fromHex(o)
  if (typeof o === 'string') return s2b(o) // experimental / might regret
  throw new Error('Uint8Array coercion failed')
}

const hexes = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0')
)

/** @param {Uint8Array} bytes
  * @returns {string} */
export function bytesToHex (bytes) {
  au8(bytes)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]]
  }
  return hex
}

export function typeOf (o) {
  if (o === null) return 'null'
  if (Array.isArray(o)) return 'array'
  if (o instanceof Uint8Array) return 'u8'
  return typeof o
}

const asciis = { _0: 48, _9: 57, _A: 65, _F: 70, _a: 97, _f: 102 }
function asciiToBase16 (char) {
  if (char >= asciis._0 && char <= asciis._9) return char - asciis._0
  if (char >= asciis._A && char <= asciis._F) return char - (asciis._A - 10)
  if (char >= asciis._a && char <= asciis._f) return char - (asciis._a - 10)
}

/** @param {string} hex
 * @returns {Uint8Array} */
export function hexToBytes (hex) {
  if (typeof hex !== 'string') throw new Error('expected string, got ' + typeof hex)
  const hl = hex.length
  const al = hl / 2
  if (hl % 2) throw new Error('odd length string: ' + hl)
  const array = new Uint8Array(al)
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi))
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1))
    if (n1 === undefined || n2 === undefined) {
      const char = hex[hi] + hex[hi + 1]
      throw new Error('non-hex character "' + char + '" at index ' + hi)
    }
    array[ai] = n1 * 16 + n2
  }
  return array
}

export async function sha256 (buffer) {
  return toU8(await globalThis.crypto.subtle.digest('sha-256', au8(buffer)))
}
