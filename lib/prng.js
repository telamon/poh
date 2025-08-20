export class PRNG {
  static MAX_ROUNDS = 32 // TODO: Should be configurable Hero.level + 20
  _base = null
  seed = null
  rounds = 0
  offset = 0
  inputs = []
  outputs = []
  #onexhaust = () => {}

  get consumed () { return this.rounds * 32 + this.offset }

  constructor (seed, onexhaust) {
    this._base = this.seed = toU8(seed)
    this.#onexhaust = onexhaust
  }

  async replay (inputs) {
    if (this.rounds !== 0 && this.offset !== 0 && cmp(this._base, this.seed)) {
      throw new Error('replay() requires initial state')
    }
    for (const input of inputs) {
      const op = input[0]
      switch (op) {
        case 'roll':
          await this.roll(...input.slice(1))
          break
        case 'bytes':
          await this.randomBytes(...input.slice(1))
          break
      }
    }
  }

  async restore (state = {}) {
    if (this.rounds !== 0 && this.offset !== 0 && cmp(this._base, this.seed)) {
      throw new Error('restore() requires initial state')
    }
    const { rounds, offset } = state
    for (let i = 0; i < rounds; i++) await this._next()
    if (state?.offset) this.offset = offset
  }

  async _next () {
    this.seed = await sha256(this.seed)
    if (++this.rounds > PRNG.MAX_ROUNDS) {
      if (typeof this.#onexhaust === 'function') this.#onexhaust()
      throw new Error('Commit to Refresh Entropy')
    }
    this.offset = 0
  }

  async roll (max, min = 1) {
    const needed = bytesNeeded(min, max)
    this.inputs.push(['roll', max, min, this.rounds, this.offset])
    let n = -1
    do {
      // Re-roll seed
      if (this.seed.length < this.offset + needed) await this._next()
      // Scan forward through seed until first qualified number is found
      n = randomSeedNumber(this.seed.subarray(this.offset), min, max)
      this.offset += needed
    } while (n === -1)
    this.outputs.push(['roll', n, this.rounds, this.offset])
    return n
  }

  /**
   * @param {any[]} options
   * @param {number[]} weights Positive integer weights only
   * @returns {any} one random option
   */
  async pickOne (options, weights) {
    if (options.length !== weights.length) throw new Error(`Lengths mismatch: options[${options.length}] != weights[${weights.length}]`)
    const total = weights.reduce((sum, w) => w + sum, 0)
    const n = await this.roll(total)
    let d = 0
    for (let i = 0; i < options.length; i++) {
      d += weights[i]
      if (d >= n) return options[i]
    }
    throw new Error('unreachable')
  }

  async randomBytes (n) {
    this.inputs.push(['bytes', n, this.rounds, this.offset])
    const b = new Uint8Array(n)
    let dstOffset = 0
    while (dstOffset < n) {
      const available = this.seed.length - this.offset
      if (!available) await this._next()
      const taken = Math.min(available, n - dstOffset)
      const src = this.seed.subarray(this.offset, this.offset + taken)
      b.set(src, dstOffset)
      this.offset += taken
      dstOffset += taken
    }
    this.outputs.push(['bytes', n, b, this.rounds, this.offset])
    return b
  }

  get spent () {
    return this.offset + this.rounds * 32
  }
}
