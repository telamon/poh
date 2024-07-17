import { Hero, JOB_PRIMITIVES } from './player.js'
import { SimpleKernel } from 'picostack'
// import { BrowserLevel } from 'browser-level'
import { MemoryLevel } from 'memory-level'
import { randomSeedNumber, bytesNeeded } from 'pure-random-number'
import { mute, get, write, combine } from 'piconuro'
import { pack, unpack } from 'msgpackr'
// import { encode, encodingLength, decode, binstr } from 'binorg/binorg.js'
import { ITEMS, I, AREAS, DUNGEONS, E } from './db.js'
import { binstr, mapOverlap, Binorg, TWOBYTER, roundByte, insertLifeMarker, downShift, upShift } from './binorg.js'
export * as DB from './db.js'

export class Kernel extends SimpleKernel {
  /** @type {PvESession} */
  _pve = null
  _pve_hero = write()
  _msg_line = write({ type: 'none' })

  constructor (db) {
    super(db)
    this.store.register(HeroCPU(() => this.pk))
  }

  get session () { return this._pve }

  get $messages () { return this._msg_line[0] }

  get $player () {
    const $blockState = mute(
      s => this.store.on('players', s),
      (players) => {
        if (!this.pk) return
        const player = players[btok(this.pk)]
        if (!player) return // Create a hero first
        return upgradePlayer(this.pk, player)
      }
    )
    const c = combine($blockState, this._pve_hero[0])
    return mute(c, ([block, pve]) => pve || block) // prefer virtual PvE-state, remember to clean on commit
  }

  // godot cannot handle '$' method names nor iterate JS-Arrays
  get on_player () { // but neuro is flexible
    return mute(this.$player, value => JSON.stringify(value))
  }

  get on_message () {
    return mute(this.$messages, value => JSON.stringify(value))
  }

  /**
   * Spawns a new hero
   * @param {string} name Name of Hero
   * @param {string} memo Shows on death/tombstone
   */
  async createHero (name, memo) {
    return this.createBlock(null, 'spawn_player', { name, memo })
  }

  async beginPVE () {
    const psig = await this.repo._getHeadPtr(this.pk) // || await this.feed(1).last.sig.toString('hex')
    const cs = get(this.$player)
    this._pve = new PvESession(this.pk, await sha256(psig), cs, this._pve_hero[1], this._msg_line[1])
    return this._pve
  }

  async commitPVE () {
    if (!this._pve) throw new Error('No Active Session')
    const session = this._pve

    const { jobPoints } = computeProgress(session.hero.experience, session.hero.career)
    if (jobPoints !== 0) throw new Error('UnspentJobpoints')

    // console.log('Precommit outputs', session._rng.outputs)
    this._pve = null
    this._pve_hero[1](null) // Flush out state
    return await this.createBlock(null, 'pve', { actions: session.stack })
  }
}

// PvE Gameplay
function HeroCPU (resolveLocalKey) {
  // There's no clean solution in pico for injecting local identity ATM.
  /*
  let _key = null
  const localKey = () => {
    if (_key) return _key
    if (typeof resolveLocalKey === 'function') {
      _key = resolveLocalKey()
      if (!_key) throw new Error('RacingCondition? falsy localKey')
      return _key
    } else throw new Error('resolveLocalKey expected to be function')
  }
  */

  return {
    name: 'players',
    initialValue: {},
    filter ({ state, block, AUTHOR }) {
      const key = btok(AUTHOR)
      const data = SimpleKernel.decodeBlock(block.body)
      const { type: blockType } = data
      switch (blockType) {
        case 'spawn_player':
          if (!block.isGenesis) return 'Genesis block required'
          if (state[key]) return 'Player already spawned'
          break
        case 'pve':
          if (block.isGenesis) return 'Cant Adventure without parent'
          if (!state[key]) return 'Hero not found'
          // TODO: are there any mutations that are not caused
          // by the PvESession machine? If so then validate.
          // TODO: allow new state to be precomputed during filter,
          // and passed to reduce for application?
          break
        default:
          return 'unknown block-type'
      }
      return false
    },

    reducer ({ state, block, AUTHOR }) {
      const key = btok(AUTHOR)
      const data = SimpleKernel.decodeBlock(block.body)
      const { type: blockType } = data

      switch (blockType) {
        case 'spawn_player':
          state[key] = { // mkHero(data)
            dead: false, // TODO: probably not needed
            spawned: data.date,
            seen: data.date,
            adventures: 0, // n-sessions completed
            name: data.name,
            memo: data.memo,
            state: 'idle',
            location: 0,
            // life: 20, // Max-HP is calculated, 'n-Lives' is hardcoded
            kills: 0,
            deaths: 0, // life - deaths < 0 == perma death
            hp: 20,
            experience: 0, // Total Experience
            career: [],
            inventory: [
              { id: I.gold, qty: 100 }, // gold
              { id: I.herb, qty: 3 } // Herb
            ]
          }
          console.log('new hero discovered', key, state[key].name)
          break
        case 'pve': {
          const crap = async () => {
            const hero = upgradePlayer(AUTHOR, state[key])
            const sess = new PvESession(AUTHOR, await sha256(block.parentSig), hero)
            await sess.replay(data.actions) // is async, picostore is sync, shit.
            // console.log('Replay outputs', sess._rng.outputs)
            const dst = state[key]
            dst.seen = data.date
            dst.state = 'idle' // Todo, remove HL prop-'state' from LL state.
            dst.adventures++
            const propsToCopy = [
              'location',
              'deaths',
              'hp',
              'experience',
              'career',
              'inventory',
              'exhaustion',
              'kills'
            ]
            for (const p of propsToCopy) dst[p] = sess.hero[p]
            // console.log('Lowlevel updated', dst)

            // TODO: monkey trigger update... and rewrite picostore
            for (const n of this.observers) n(state)
          }
          crap()
            .catch(err => console.error('CRITICAL HeroCPU Failure!', err))
        } break
        default:
          throw new Error('unkown_block_type:' + blockType)
      }
      return { ...state }
    }
  }
}

export function btok (b, length = -1) { // 'base64url' not supported in browser :'(
  if (Buffer.isBuffer(b) && length > 0) {
    b = b.subarray(0, Math.min(length, b.length))
  }
  return b.toString('hex')
}

export function ktob (s) {
  if (typeof s !== 'string') throw new Error('Expected string')
  return Buffer.from(s, 'hex')
}

/**
 * Converts low-level  player-state into
 * high-level character sheet
 * @param {Bufer|Uint8Buffer} pk Public Key
 * @param {any} Lowlevel state
 */
function upgradePlayer (pk, state) {
  const characterSheet = {
    ...state,
    exhaustion: 0,
    ...computeProgress(state.experience, state.career)
  }

  levelUp(pk, characterSheet)

  characterSheet.stats = computeStats(characterSheet)
  characterSheet.equipment = viewEquipped(characterSheet.inventory)
  return characterSheet
}
/**
 * TODO: move function to bootloader.js
 * avoid setting globalThis.K in production builds
 */
export async function boot (cb) {
  console.log('boot() called, allocating memory')
  const DB = new MemoryLevel('rant.lvl', {
    valueEncoding: 'buffer',
    keyEncoding: 'buffer'
  })
  const kernel = new Kernel(DB)
  await kernel.boot()
  globalThis.K = kernel
  if (typeof cb === 'function') cb(kernel)
  return kernel
}

async function sha256 (buffer) {
  return toU8(await globalThis.crypto.subtle.digest('sha-256', buffer))
}
/* BUFFER UTILS: TODO import from pifofeedv8 */
/** assert Uint8Array[length]
  * @type {(a: Uint8Array, l?: number) => Uint8Array} */
export const au8 = (a, l) => {
  if (!(a instanceof Uint8Array) || (typeof l === 'number' && l > 0 && a.length !== l)) throw new Error('Uint8Array expected')
  else return a
}
export const toHex = (buf, limit = 0) => Buffer.from(limit ? buf.slice(0, limit) : buf).toString('hex')
export const fromHex = b => Buffer.from(b, 'hex') // hexToBytes
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
  // if (typeof o === 'string' && /^[a-f0-9]+$/i.test(o)) return fromHex(o)
  // if (typeof o === 'string') return s2b(o) // experimental / might regret
  throw new Error('Uint8Array coercion failed')
}
/* End of bufer utils */

export class PRNG {
  static MAX_ROUNDS = 32
  _base = null
  seed = null
  rounds = 0
  offset = 0
  inputs = []
  outputs = []

  get consumed () { return this.rounds * 32 + this.offset }

  constructor (seed) {
    this._base = this.seed = toU8(seed)
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
    if (++this.rounds > PRNG.MAX_ROUNDS) throw new Error('Commit to Refresh Entropy')
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

class PvESession {
  started = Date.now()
  /** @type {PRNG} */
  _rng = null
  hero = null
  _notifyChange = null
  stack = []
  #counter_items_spawned = 0
  #battle = null

  get location () { return this.hero.location }
  get state () { return this.hero.state }
  get area () { return AREAS[this.location] }
  /** @type {Array} */
  get inventory () { return this.hero.inventory }
  /** @type {number} */
  get balance () { // gold
    return this.inventory.find(i => i.id === I.gold)?.qty || 0
  }

  /** @type {EquippedView} */
  get equipment () { return viewEquipped(this.inventory) }

  get stats () { return computeStats(this.hero) }

  constructor (author, seed, hero, onChange = () => {}, sendMessage = () => {}) {
    this.author = author
    this.hero = clone(hero)
    this._rng = new PRNG(seed)
    this.hero.state = 'adventure'
    this._sendMessage = sendMessage

    this._notifyChange = () => onChange({
      ...clone({
        ...this.hero,
        exhaustion: this._rng.spent,
        stats: computeStats(this.hero),
        equipment: this.equipment,
        ...computeProgress(this.hero.experience, this.hero.career)
      })
    })

    this._notifyChange()
  }

  _push (action) {
    this.stack.push(action)
  }

  get isPathChosen () { return false }

  async choosePath (job) {
    if (!~JOB_PRIMITIVES.indexOf(job)) throw new Error(`Path must be single letter of [${JOB_PRIMITIVES.join('')}]`)
    const career = this.hero.career
    const xp = this.hero.experience
    const [lvl] = levelFromXp(xp)
    if (lvl <= career.length * 3) throw new Error('Path cannot be chosen yet')
    career.push(job)
    this._push({ type: 'path', job })
    return this._levelUp()
  }

  _levelUp () {
    const payload = levelUp(this.author, this.hero)
    if (payload) {
      this._notifyChange()
      this._sendMessage({ type: 'level_up', payload })
    }
    return payload
  }

  async travelTo (areaId) {
    const connected = this.area.exits.some(exit => exit === areaId)
    if (!connected) throw new Error(`Cannot travel to ${areaId} from ${this.area.id}`)
    if (!(areaId in AREAS)) throw new Error(`Unknown Area #${areaId}`)
    this._push({ type: 'travel', areaId, from: this.location })
    this.hero.location = areaId
    this._notifyChange()
  }

  async explore (dungeonId) {
    const connected = this.area.dungeons.some(d => d === dungeonId)
    if (!connected) throw new Error(`Dungeon ${dungeonId} does not exist in ${this.area.id}`)
    const dungeon = DUNGEONS[dungeonId]
    if (!dungeon) throw new Error(`Unknown Dungeon ${dungeonId}`)
    this._push({ type: 'explore', dungeonId })
    const { encounters } = dungeon
    // Roll Encounter
    const event = await this._rng.pickOne(encounters, encounters.map(e => e.chance))
    if (event.type === 'monster') {
      // const org = spawnMonster(event.size, event.baseStats)
      const nbits = TWOBYTER * 3 + 1
      const dna = new Uint8Array(roundByte(nbits))
      insertLifeMarker(dna, nbits)
      const spawn = new Binorg(TWOBYTER, dna)
      // Random level-up
      const lvl = this.hero.lvl <= event.lvl.min
        ? event.lvl.min // no point rolling, scale down, save entropy
        : await this._rng.roll(event.lvl.max, Math.min(this.hero.lvl, event.lvl.min))
      const randStats = await this._rng.randomBytes(roundByte(lvl))
      for (let i = 0; i < lvl; i++) spawn.progress(downShift(randStats)) // downshift is safe with u8's , upshift is not.
      this.#battle = {
        event,
        spawn: {
          type: event.type,
          name: event.name,
          lvl,
          hp: event.hp + lvl,
          pwr: event.baseStats[0] + spawn.pwr,
          agl: event.baseStats[1] + spawn.agl,
          wis: event.baseStats[2] + spawn.wis
        }
      }
      this.#battle.spawn.stats = computeStats(this.#battle.spawn)
      this.hero.state = 'battle'
      this._notifyChange()
      return this.#battle.spawn
    } else {
      throw new Error('unreachable')
    }
  }

  /**
   * @param {string} action attack|run|use|SKILLNAME
   * @param {any} pass item id when action = 'use'
   */
  async doBattle (action, arg = null) {
    if (this.state !== 'battle') throw new Error('NotFighting')
    this._push({ type: 'battle', action, arg })
    const hero = this.hero
    const spawn = this.#battle.spawn
    const hits = []
    // TODO: rng.getRandomBytes(1) do initative roll for both splitting 8 bits into 4 (each rolls d16)
    if (hero.agl > spawn.agl) {
      const r1 = await attack(hero, spawn, this._rng)
      hits.push(r1)
      if (r1.type !== 'kill') hits.push(await attack(spawn, hero, this._rng))
    } else {
      const r1 = await attack(spawn, hero, this._rng)
      hits.push(r1)
      if (r1.type !== 'kill') hits.push(await attack(hero, spawn, this._rng))
    }

    for (const hit of hits) hit.own = hit.attacker === hero.name // Is hero attack

    let type = 'exchange'
    const lastHit = hits[hits.length - 1]
    if (lastHit.type === 'kill') {
      type = lastHit.own
        ? 'victory'
        : 'defeat'
    }
    const out = { type, hits, spawn, loot: [] }
    if (type === 'victory') {
      const { loot, xp } = this.#battle.event
      out.xp = xp + spawn.lvl
      hero.experience += out.xp
      hero.kills += 1
      // this.addInventory({ id: 1, qty: 99 }, true) // hard gold?
      let nItems = 0
      if (loot.length > 0) {
        nItems = await this._rng.pickOne(
          [0, 1, 2, 3, 4],
          [2, 5, 4, 2, 1]
        )
        if (this.hero.skills.includes(s => s === 'Scavenge')) nItems++
        nItems = Math.min(nItems, loot.length)
      }

      for (let i = 0; i < nItems; i++) {
        const item = await this._rng.pickOne(loot.map(clone), loot.map(i => i.chance))
        const spec = this._getItemSpec(item)
        const existing = out.loot.find(({ id }) => id === item.id)
        if (spec.stacks) {
          if (existing) existing.qty += item.qty // TODO: attach diminishing returns
          else out.loot.push({ id: item.id, qty: item.qty })
        } else if (!existing) {
          out.loot.push(await this._spawnItem(item, true)) // Prevent looting same object twice
        }
      }

      this.addInventory(out.loot, true)
      hero.state = 'adventure'

    } else if (type === 'defeat') {
      hero.hp = 10
      hero.deaths++
      hero.location = 0
      hero.state = 'adventure'
    }
    let ding
    try {
      ding = this._levelUp()
    } catch (e) {
      console.warn('squelching assumed career length error', e)
    }
    if (!ding) this._notifyChange()
    return out
  }

  /**
   * @typedef {{ id: number, qty: number }} Item
   * @typedef {Item & { uid: string, equipped?: boolean, qty: 1 }} UniqueItem
   * @typedef {number} ItemID
   * @typedef {string} ItemUID
   * @typedef {ItemID|ItemUID|Item|UniqueItem} LocalItem
   *
   * @typedef {{
   *   id: number,
   *   name: string,
   *   description: string,
   *   vendorPrice: number,
   *   stacks: boolean,
   *   sells: boolean,
   *   discards: boolean,
   *   usable: boolean,
   *   usableCombat: boolean,
   *   equip: number
   *   stats?: { pwr: number, dex: number, wis: number }
   * }} ItemSpec
   */

  /**
   * @param {Item|Item[]} items
   */
  addInventory (items, noNotify = false) {
    if (!Array.isArray(items)) items = [items]
    const inventory = this.inventory
    for (const item of items) {
      const spec = ITEMS[item.id]
      // console.log(item)
      if (!spec) throw new Error('CannotStashUnknownItem' + item.id)
      // Ensure prop qty exists on stackable
      if (spec.stacks && !Number.isSafeInteger(item.qty)) item.qty = 1
      // Try increasing quanitty of stackable items
      if (spec.stacks) {
        const existing = inventory.find(i => i.id === item.id)
        if (existing) {
          existing.qty += item.qty
          continue
        }
      }
      // Else just append it
      inventory.push(item)
    }
    if (!noNotify) this._notifyChange()
  }

  /**
   * Removes an item either by
   *  - id+qty
   *  - just id(stackable) assuming qty: 1
   *  - or string:uid(non-stackable)
   *
   * @param {LocalItem|LocalItem[]} items
   * @param {boolean} noNotify Don't notify frontend of change (yet)
   */
  removeInventory (items, noNotify = false) {
    if (!Array.isArray(items)) items = [items]
    const inventory = this.inventory
    for (const item of items) {
      const spec = this._getItemSpec(item)
      const id = spec.id

      if (spec.stacks) {
        const existing = inventory.find(i => i.id === id)
        const qty = item.qty || 1
        if (existing.qty < qty) throw new Error('InsufficientQuantity')
        existing.qty -= qty
        if (existing.qty === 0) inventory.splice(inventory.indexOf(existing), 1)
      } else {
        const uid = typeof item === 'string' ? item : item.uid
        if (typeof uid === 'undefined') throw new Error('ItemUID Not found')
        const idx = inventory.findIndex(i => uid === i.uid)
        if (!~idx) throw new Error(`Item uid:${uid} not found`)
        inventory.splice(idx, 1)
      }
    }
    if (!noNotify) this._notifyChange()
  }

  async interact (npcId, action, ...args) {
    const npc = this.area.npcs[npcId]
    if (!npc) throw new Error(`Unknown NPC[${npcId}]`)
    let response = null

    switch (action) {
      case 'buy': {
        let [offerId, qty] = args // TODO: use itemIdx?
        qty ||= 1

        if (!npc.sells) throw new Error(`NPC[${npcId}] does not sell anything`)

        const offered = npc.sells.find(i => Number.isInteger(i) ? i === offerId : i.id === offerId)
        const itemId = Number.isInteger(offered) ? offered : offered.id
        if (!offered || !itemId) throw new Error(`NPC[${npcId}] does not sell Item[${offerId}]`)

        const spec = this._getItemSpec(itemId)
        const price = Math.ceil(spec.vendorPrice * 1.25)
        if (price * qty > this.balance) throw new Error('Insufficient Gold')

        this.removeInventory({ id: I.gold, qty: price }, true)
        const addItem = spec.stacks
          ? { id: itemId, qty }
          : await this._spawnItem(offered)
        this.addInventory(addItem)
        response = { npcsay: 'Thank you for your purchase' }
      } break

      case 'sell': {
        let [target, qty] = args
        const spec = this._getItemSpec(target)
        const price = Math.floor(spec.vendorPrice * 0.75)
        if (spec.stacks) {
          qty ||= 1
          if (Number.isInteger(target)) target = { id: target, qty }
          if (typeof target === 'string') target = { uid: target, qty }
        }
        this.removeInventory(target, true)
        this.addInventory({ id: I.gold, qty: price })
      } break

      default:
        throw new Error(`Unknown NPC-interaction "${action}"`)
    }
    this._push({ type: 'interact', npc: npcId, action, args })
    return response
  }

  /**
   * Looks up spec by id, Item.id
   * or uid if item is in inventory.
   * @param {LocalItem} target
   * @return {ItemSpec}
   */
  _getItemSpec (target) {
    const id = typeof target === 'string'
      ? this.inventory.find(i => i.uid === target)?.id
      : Number.isInteger(target) ? target : target.id
    if (typeof id === 'undefined') throw new Error(`Could not resolve to item: ${JSON.stringify(target)}`)
    if (!(id in ITEMS)) throw new Error(`ItemSpec Not Found ${id}`)
    return ITEMS[id]
  }

  async _spawnItem (item, rollStats = false) {
    const spec = ITEMS[Number.isInteger(item) ? item : item.id]
    const instance = Number.isInteger(item) ? { id: item } : clone(item)
    instance.qty = 1
    delete instance.chance // Silly workaround

    if (item.stats) instance.stats = clone(item.stats)
    else if (spec.stats) instance.stats = clone(spec.stats)
    if (spec.type === 'equipment') instance.equipped = false
    if (instance.stats && rollStats) {
      // instance.todoRandom = true
      // TODO: roll stats from spec? (only on loot drops, not on vendor buy)
    }

    // TODO: use psig not rng/base
    const seed = this._rng._base.slice(0, 8)
    const ctr = ++this.#counter_items_spawned
    seed[6] = (ctr >>> 8) & 0xff
    seed[7] = ctr & 0xff
    instance.uid = toHex(seed)
    console.info('ItemSpawned', instance.uid, instance)
    // TODO: decide wether or not we want wish to have schrödingers unindentified axe
    return instance
  }

  /**
   * @param {LocalItem} id
   */
  async useItem (id) {
    const spec = this._getItemSpec(id)
    if (spec.type === 'equipment') {
      if (this.state === 'battle') throw new Error('Cannot equip during battle')
      if (typeof id !== 'string') throw new Error('Expected item:uid:string but got ' + id)
      const item = this.inventory.find(i => i.uid === id)
      if (!item) throw new Error('Equipment not found in inventory')
      if (item.equipped) {
        item.equipped = false
      } else {
        // Unequip existing
        const current = this.equipment
        if (spec.equip & E.HEAD && current.head) current.head.equipped = false // unequip
        if (spec.equip & E.BODY && current.body) current.body.equipped = false // unequip
        if (spec.equip & E.FEET && current.feet) current.feet.equipped = false // unequip
        if (spec.equip & E.RIGHT && current.right) current.right.equipped = false // unequip
        if (spec.equip & E.LEFT && current.left) current.left.equipped = false // unequip
        item.equipped = true
      }
      this._push({ type: 'use', item: item.uid })
      this._notifyChange()
    } else if (spec.type === 'consumable') {
      if (this.state === 'battle' && !spec.usableCombat) throw new Error(`${spec.name} cannot be used during combat`)
      const { effect } = spec
      switch (effect.type) {
        case 'heal': {
          let { amount, bonus } = effect // validate?
          if (Number.isInteger(bonus) && bonus > 0) {
            const r = await this._rng.roll(20)
            if (r > 10) amount += Math.floor(bonus / 2)
            if (r === 20) amount += bonus
          }
          this.hero.hp = Math.min(this.hero.hp + amount, this.hero.maxhp)
        } break
        default: {
          const msg = `Consumable item ${spec.name} effect ${effect} not yet implemented`
          console.error(msg)
          throw new Error(msg)
        }
      }

      this.removeInventory(id) // does this._notifyChange()
      this._push({ type: 'use', item: id })
    } else {
      console.warn('Attempted to use unusable item ' + id)
      return { message: `${spec.name} cannot be used nor equipped.` }
    }
    return null
  }

  async replay (actions) {
    for (const action of actions) {
      switch (action.type) {
        case 'travel':
          await this.travelTo(action.areaId)
          break
        case 'explore':
          await this.explore(action.dungeonId)
          break
        case 'battle':
          await this.doBattle(action.action, action.arg)
          break
        case 'interact':
          await this.interact(action.npc, action.action, ...action.args)
          break
        case 'use':
          await this.useItem(action.item)
          break
        default:
          throw new Error('Unknown PvEAction: ' + action.type)
      }
    }
  }
}
/** (The PvEbattle system)
  * warn: it mutates the defender (b)  */
async function attack (charA, charB, rng) {
  const a = computeStats(charA)
  const b = computeStats(charB)
  const hitRoll = await rng.roll(20)
  const treshold = 10 + b.agl - a.agl

  // Rolling below threshold is a miss, unless critical
  if (treshold > hitRoll && hitRoll !== 20) {
    return { type: 'miss', attacker: charA.name }
  }

  let type = 'normal' // It's a hit.

  let { atk } = a // Base atk stat of attacker

  if (hitRoll === 20) {
    type = 'crit'
    atk *= 1.5 // bonus damage
  } else if (hitRoll >= 17) {
    type = 'good'
    atk *= 1.25 // bonus damage
  }
  // console.log('def', b.def, ' atk', atk, ' dmg:', atk - b.def)
  const damage = Math.ceil(Math.max(atk - b.def, 0))

  charB.hp -= damage // Apply damage to HP
  if (charB.hp < 1) type = 'kill'

  return { type, damage, attacker: charA.name }
}

/**
 * @typdef {{ pwr: number, agl: number, wis: number, atk: number, def: number, matk: number }} Stats
 * @returns {Stats}
 */
function computeStats (character) {
  let { pwr, agl, wis, atk, def, matk } = character // Base Stats
  // Initialize t2 stats (only monsters may have them)
  atk ||= 0
  def ||= 0
  matk ||= 0

  if (Array.isArray(character.inventory)) {
    for (const item of character.inventory) {
      if (item.equipped && item.stats) {
        if (item.stats.pwr) pwr += item.stats.pwr
        if (item.stats.agl) agl += item.stats.agl
        if (item.stats.wis) wis += item.stats.wis
        if (item.stats.atk) atk += item.stats.atk
        if (item.stats.def) def += item.stats.def
        if (item.stats.matk) matk += item.stats.matk
        // TODO: rewrite all hero.maxhp lookups in order to add hp modifier
      }
    }
  }
  atk += pwr + Math.floor(agl * 0.6)
  def += agl + Math.floor(wis * 0.333)
  matk += wis + Math.floor((pwr + agl) * 0.2)
  return { pwr, agl, wis, atk, def, matk }
}

/**
 * @typedef {{
 *  head: UniqueItem|undefined,
 *  body: UniqueItem|undefined,
 *  feet: UniqueItem|undefined,
 *  right: UniqueItem|undefined,
 *  left: UniqueItem|undefined,
 * }} EquippedView
 * @param {Item[]} inventory
 * @return {EquippedView}
 */
export function viewEquipped (inventory) {
  /** @type {EquippedView} */
  const view = { left: undefined, right: undefined, head: undefined, body: undefined, feet: undefined }
  for (const item of inventory) {
    if (!(item.id in ITEMS)) throw new Error('ItemSpec not found!')
    const { type, equip } = ITEMS[item.id]
    if (type !== 'equipment') continue
    if (equip === E.NONE) throw new Error('Unequippable equipment')
    if (!item.equipped) continue
    assertFree(equip)
    if (equip & E.RIGHT) view.right = item
    if (equip & E.LEFT) view.left = item
    if (equip & E.HEAD) view.head = item
    if (equip & E.BODY) view.body = item
    if (equip & E.FEET) view.feet = item
  }

  return view

  function assertFree (flags) {
    if (flags & E.LEFT && view.left) throw new Error('DoubleQuip! LEFT is occupied')
    if (flags & E.RIGHT && view.right) throw new Error('DoubleQuip! RIGHT is occupied')
    if (flags & E.HEAD && view.head) throw new Error('DoubleQuip! HEAD is occupied')
    if (flags & E.BODY && view.body) throw new Error('DoubleQuip! BODY is occupied')
    if (flags & E.FEET && view.feet) throw new Error('DoubleQuip! FEET is occupied')
  }
}

export function clone (o) { return unpack(pack(o)) }
export function xpToLevel (n) { return Math.floor(100 * (1.3 ** n)) }
export function levelFromXp (totalXp) {
  if (!Number.isSafeInteger(totalXp)) throw new Error('Expected number, got: ' + totalXp)
  let lv = 0
  while (1) {
    totalXp -= xpToLevel(++lv)
    if (totalXp < 0) return [lv - 1, -totalXp]
  }
}

/**
 * @param {Uint8Array} dna
 * @param {Hero} hero
 * @returns {undefined|{ pwr: number, agl: number, wis: number, profession?: string, skills_added: string[], skills_consumed: string[] }} levelUp diff
 */
export function levelUp (dna, hero) {
  const { career, experience: xp } = hero
  const [lvl] = levelFromXp(xp)
  // const nextXP = xpToLevel(lvl + 1)

  if (lvl > career.length * 3) throw new Error(`Insufficient career length, have: ${career.length} required: ${Math.ceil(lvl / 3)}`)

  const nUp = lvl - hero.lvl

  if (nUp < 1) return // nothing to do

  const path = [1]
  for (let i = 0; i < lvl; i++) {
    const job = JOB_PRIMITIVES.indexOf(career[Math.floor(i / 3)])
    upShift(path, (job >>> (i % 3)) & 0b1)
  }
  const exp = [1]
  mapOverlap([dna, path], ([d, x]) => upShift(exp, d ^ x))

  const binorg = new Hero(85, dna, exp) // CRYPTORG=85*3=256bit, DNA = AUTHOR public key, XP = binary career

  const base = 3
  // Generate diff
  const diff = {
    lvl,
    pwr: (base + binorg.pwr) - (hero.pwr || 0),
    agl: (base + binorg.agl) - (hero.agl || 0),
    wis: (base + binorg.wis) - (hero.wis || 0),
    skills_added: [],
    skills_consumed: []
  }
  const p = binorg.profession
  const job = p.job || 'Jobless'
  if (job !== hero.profession) diff.profession = job
  for (const s in p.skills) if (!~hero.skills.indexOf(s)) diff.skills_added.push(s)
  for (const s in hero.skills) if (!~p.skills.indexOf(s)) diff.skills_consumed.push(s)
  // console.log('_p', p)

  // Update hero with new properties
  hero.lvl = lvl
  hero.pwr = base + binorg.pwr
  hero.agl = base + binorg.agl
  hero.wis = base + binorg.wis
  hero.profession = job
  hero.gender = binorg.gender ? 'male' : 'female'
  hero.path = p.path // This is the current state after growth
  hero.skills = p.skills
  hero.life = 3 + Math.floor((lvl / 3)) * 2 // +2 lives every 3 levels (maybe deprecated/hardcore)
  hero.turns = 64 + lvl // This is stamina against exhaustion, more level, more sha256 hashes
  hero.maxhp = 20 + hero.pwr + Math.floor((lvl / 3)) * 5
  hero.hp = hero.maxhp // Heal Up on ding
  hero._path = p.path // Export poh2019 L-symbols
  hero._path_o = p.originalPath // --""--
  return diff
}

/**
 * @param {number} xp Total Experience points
 * @param {string|string[]} career Chosen path
 * @returns {{ xpNext: number, xpRel: number, jobPoints: number }}
 */
function computeProgress (xp, career) {
  if (typeof career === 'string') career = career.split('')
  const [lvl, remain] = levelFromXp(xp)
  const xpNext = xpToLevel(lvl + 1)
  const xpRel = xpNext - remain
  const jobPoints = Math.ceil(lvl / 3) - career.length
  return { xpNext, xpRel, jobPoints }
}
