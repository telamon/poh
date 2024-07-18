// const varint = require('varint')
const randomBytes = (n) => {
  const buf = new Uint8Array(n)
  globalThis.crypto.getRandomValues(buf)
  return buf
}

/*
 * Sizes where (bits - 1) is divisble by 3
 * really any 3 * n + 1 size goes but let's
 * minimize litter bytes in cyberspace
 *
> Array.from(new Array(32)).map((_,i)=>1<<i).filter(i => i % 3 === 1).map(i => i>>3)
[ 2,   16bit    Cryptoling
  8,   64bit    Hashmob
  32,  256bit   Player
  128, 1024bit  Raid-boss
  512,
  2048,
  8192 ]
*/

/* eslint-disable no-multi-spaces */

/*
 * Chosen multiple of 3 configurations
 */
export const NIBBLING =   2    // 7bit
export const TWOBYTER =   5    // 16bit
export const HASHCHAR =   21   // 64bit
export const CRYPTORG =   85   // 256bit
export const CRYPTOLISK = 341  // 1024bit
/* eslint-enable no-multi-spaces */

const noBuf = {
  allocUnsafe (s) { return Array.from(new Array(s)) },
  alloc (s) { return allocUnsafe.map(() => 0) }
}

const { alloc, allocUnsafe } = (typeof Buffer !== 'undefined') ? Buffer : noBuf

export const DEF_SIZE = 8
/*
function countLeadingZeroes (p, SIZE = DEF_SIZE) {
  let n = 0
  for (let i = 0; i < SIZE; i++) {
    let b = p[i]
    for (let j = 0; j < 8; j++) {
      if (b & 1) return n
      n++
      b >>= 1
    }
  }
}
*/

/*
export function inspect (x, SIZE = DEF_SIZE) {
  console.debug('Inspecting Cryptoling', x.hexSlice())
  console.log('DNA Sequence:', _toStr(x))
  const str = strengthOf(x)
  const agl = agilityOf(x)
  const intl = intelligenceOf(x)

  let cls = 'Villager'
  const maxStat = (SIZE * 8 - ((SIZE * 8) % 3))
  const avg = maxStat >> 1

  if (str > avg && agl > avg && intl > avg) cls = 'Archvillager'
  else if (str > avg && agl > avg) cls = 'Monk'
  else if (agl > avg && intl > avg) cls = 'Marksman'
  else if (str > avg && intl > avg) cls = 'Spellsword'
  else if (str > avg) cls = 'Warrior'
  else if (agl > avg) cls = 'Rogue'
  else if (intl > avg) cls = 'Mage'

  console.table({
    CLASS: cls,
    LIFE: lifeOf(x),
    STR: str,
    AGL: agl,
    INT: intl
  })
}
*/
export class Binorg {
  constructor (mulitpleOf3, ...crdtMems) {
    this.m3 = mulitpleOf3
    this.nb = mulitpleOf3 * 3 + 1
    this.dna = crdtMems[0] || roll(this.nb)
    this.exp = crdtMems[1] || [1] // empty lvl 0
  }

  get lvl () {
    const z = countTrailingZeroes(this.exp) +
      this.nb - (this.exp.length << 3)
    return this.m3 * 3 - z
  }

  get life () {
    const damage = countTrailingZeroes(this.dna) +
      this.nb - (this.dna.length << 3)
    return this.m3 * 3 - damage
  }

  // Holy trinity
  get pwr () { return this._extractAttr(0b110, 3) }
  get agl () { return this._extractAttr(0b101, 3) }
  get wis () { return this._extractAttr(0b011, 3) }

  damage (points) {
    if (points < 1) return
    while (points--) downShift(this.dna)
  }

  progress (parity) {
    const x = this.exp
    const o = upShift(x, parity)
    if (o) { // create new byte when bit overflows
      if (Array.isArray(x)) x[x.length] = 1
      else { // resize buffer
        this.exp = alloc(roundByte(this.m3 * 3 + 1))
        for (let i = 0; i < x.length; i++) this.exp[i] = x[i]
        this.exp[x.length] = 1
      }
    }
  }

  // return a list of n trailing zeros of each pad.
  get clock () {
    // TODO: figure out how to do this for dynamic list of shiftregisters.
    // Currently the problem is knowing if it a shrinking or expanding
    // register
    return [
      this.m3 * 3 - this.life, // Same as 'accumulated damage'
      this.lvl
    ]
  }

  _binorgInspect () {
    const clzzName = Object.getPrototypeOf(this).constructor.name
    let str = `${clzzName}[${this.clock}] {\n`
    str += `  Size: ${this.m3 * 3 + 1}bit\n`
    str += `  LVL: ${this.lvl}  HP ${this.life}\n`
    str += `  PWR: ${this.pwr} AGL: ${this.agl} WIS: ${this.wis}\n`
    str += `  DNA: ${binstr(this.dna)}\n`
    str += `  EXP: ${binstr(this.exp)}\n`
    str += '}\n'
    return str
  }

  _extractAttr (mask, d) {
    let i = 0
    let o = 0
    mapOverlap([this.dna, this.exp], ([d, x]) => {
      const b = d ^ x ^ ((mask >> (i++ % 3)) & 1)
      if (b) o++
      return b
    })
    return o
  }

  // Class is next to useless without theese methods.
  static get decode () { return decode }
  static get encode () { return encode }
  static get encodingLength () { return encodingLength }
}

// Round bits upwards to closet byte
export function roundByte (b) { return (b >> 3) + (b % 8 ? 1 : 0) } // = Math.ceil(b / 8)

/*
 * Treats buffer as a series of latched 8bit shift-registers
 * shifts all bits 1 step from low to high.
 *             _____________
 *   input -> | 0 1 0 1 1 1 | -> return overflow
 *             -------------
 *           Low            High
 */
export function upShift (x, inp = 0) {
  let c = inp ? 1 : 0
  for (let i = 0; i < x.length; i++) {
    const nc = (x[i] >> 7) & 1
    x[i] = (x[i] << 1) | c
    c = nc
  }
  return c
}

/*
 * Opposite of upShift, shifts all bits
 * 1 step towards low.
 *              _____________
 *   output <- | 0 1 0 1 1 1 | <- input
 *              -------------
 *           Low            High
 */
export function downShift (x, inp = 0) {
  let i = x.length
  let c = (inp ? 1 : 0) << 7
  while (i--) {
    const nc = (x[i] & 1) << 7
    x[i] = c | x[i] >> 1
    c = nc
  }
  return c ? 1 : 0
}

export function insertLifeMarker (o, bits) {
  const r = bits % 8 ? bits % 8 : 8
  const size = o.length
  o[size - 1] = o[size - 1] & // Fix last byte
    ((1 << r) - 1) | // Mask after LIFE marker
    (1 << (r - 1)) // Insert LIFE marker
  return o
}
export function roll (bits, generator = randomBytes) {
  const size = roundByte(bits)
  const o = generator(size)
  const r = bits % 8 ? bits % 8 : 8
  o[size - 1] = o[size - 1] & // Fix last byte
    ((1 << r) - 1) | // Mask after LIFE marker
    (1 << (r - 1)) // Insert LIFE marker
  return o
}

export function countTrailingZeroes (x) {
  let i = x.length
  let n = 0 // vBits - (x.length << 3)
  while (i--) {
    for (let j = 7; j >= 0; j--) {
      if (x[i] & (1 << j)) return n
      n++
    }
  }
  return n
}

export function countOnes (p) {
  let out = 0
  for (let i = 0; i < p.length; i++) {
    let b = p[i]
    while (b) {
      if (b & 1) out++
      b >>= 1
    }
  }
  return out
}

// Higher order function to align multiple registers
// and iterate the bits within the overlap.
//
//                  Operational zone
//     Start bit    _____
//               * | | | |
// A:    0 0 0 0 1 1 0 1 0 1 1
// B:        0 0 1 0 1 1 1 1 1 1 0
// C:      0 0 0 1 0 0 1 0
//       HI        ^            LOW
//            idx: 0 1 2 3
//
export function mapOverlap (registers, process) {
  process = process || (() => {})
  const o = registers.map(() => 0)
  const found = registers.map(() => 0)
  const outputs = registers.map(() => 0)
  let sync = false
  const result = []
  let cancel = false
  while (!cancel) {
    for (let r = 0; r < registers.length; r++) {
      if (!sync && found[r]) continue // wait-state reached
      const reg = registers[r]
      const bitIdx = o[r]++
      const byteIdx = reg.length - 1 - (bitIdx >> 3)
      // return function as soon as first buffer end is reached.
      if (byteIdx < 0) return result

      const bit = (reg[byteIdx] >> (7 - (bitIdx % 8))) & 1
      if (!found[r]) {
        if (bit) found[r] = true
        continue
      }
      outputs[r] = bit
    }

    if (!sync) {
      sync = found.reduce((c, n) => c && n, true)
      continue
    }
    const z = process(outputs, () => { cancel = true })
    if (upShift(result, z)) result[result.length] = 1
  }
  return result
}

export function encodingLength (org) {
  if (!(org instanceof Binorg)) throw new Error('NotABinorgError')
  let tally = varint.encodingLength(org.m3)

  const dnaLen = org.dna.length - (countTrailingZeroes(org.dna) >> 3)
  tally += dnaLen + varint.encodingLength(dnaLen)

  const xpLen = org.exp.length - (countTrailingZeroes(org.exp) >> 3)
  tally += xpLen + varint.encodingLength(xpLen)
  return tally
}

export function encode (org, buffer, offset = 0) {
  if (!(org instanceof Binorg)) throw new Error('NotABinorgError')
  if (!buffer) buffer = allocUnsafe(encodingLength(org) + offset)
  const start = offset
  varint.encode(org.m3, buffer, offset)
  offset += varint.encode.bytes

  const dnaLen = org.dna.length - (countTrailingZeroes(org.dna) >> 3)
  varint.encode(dnaLen, buffer, offset)
  offset += varint.encode.bytes
  for (let i = 0; i < dnaLen; i++) buffer[offset + i] = org.dna[i]
  offset += dnaLen

  const xpLen = org.exp.length - (countTrailingZeroes(org.exp) >> 3)
  varint.encode(xpLen, buffer, offset)
  offset += varint.encode.bytes
  for (let i = 0; i < xpLen; i++) buffer[offset + i] = org.exp[i]
  offset += xpLen

  encode.bytes = offset - start
  return buffer
}

export function decode (buffer, offset = 0, end, Clss = Binorg) {
  if (!buffer) throw new Error('First argument must be bufferish')
  end = end || buffer.length
  const start = offset

  const m3 = varint.decode(buffer, offset)
  offset += varint.decode.bytes

  const dnaLen = varint.decode(buffer, offset)
  offset += varint.decode.bytes
  const dna = allocUnsafe(dnaLen)
  if (dnaLen + offset > end) throw new RangeError('Buffer underflow')
  for (let i = 0; i < dnaLen; i++) dna[i] = buffer[offset + i]
  offset += dnaLen

  const xpLen = varint.decode(buffer, offset)
  offset += varint.decode.bytes
  if (xpLen + offset > end) throw new RangeError('Buffer underflow')
  const xp = allocUnsafe(xpLen)
  for (let i = 0; i < xpLen; i++) xp[i] = buffer[offset + i]
  offset += xpLen

  decode.bytes = offset - start

  // TODO: 3.0 this should return { m: 21, pads: [dna, xp, ...] }
  // Each pad is a tiny single-bit writer. single bit hypercore...
  // make a rant/desc about this idea somewhere else.
  return new Clss(m3, dna, xp) // TODO: maybe just return {m3, dna, xp}
}

export function binstr (x, cap) {
  cap = cap || x.length * 8
  let str = ''
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < 8; j++) {
      if (cap === i * 8 + j) str += '|'
      str += x[i] & (1 << j) ? '1' : '0'
    }
  }
  return str
}
