import { Hero, JOB_PRIMITIVES } from './player.js'
import { SimpleKernel, Memory } from 'picostack'
import { Modem56 } from '../../picostack/modem56.js'
import { Feed, toHex, toU8, cmp, s2b, au8, getPublicKey, hexdump } from 'picofeed'
// import { BrowserLevel } from 'browser-level'
import { MemoryLevel } from 'memory-level'
import { randomSeedNumber, bytesNeeded } from 'pure-random-number'
import { mute, get, write, combine } from 'piconuro'
import { pack, unpack } from 'msgpackr'
// import { encode, encodingLength, decode, binstr } from 'binorg/binorg.js'
import { ITEMS, I, AREAS, DUNGEONS, E } from './db.js'
import { mapOverlap, Binorg, TWOBYTER, roundByte, insertLifeMarker, downShift, upShift } from './binorg.js'
export * as DB from './db.js'
const MEM_HERO = 'H'
const MEM_LIVE = 'L'

/** @typedef {import('@telamon/picostore').ExpiresFunction} ExpiresFunction */
/** @typedef {import('@telamon/picostore').ComputeFunction} ComputeFunction */
/** @typedef {import('@telamon/picostore').BlockID} BlockID */
/** @typedef {import('picofeed').SecretBin} SecretBin */
/** @typedef {import('picofeed').PublicBin} PublicBin */
/** @typedef {import('picofeed').PublicKey} PublicKey */
/** @typedef {import('picostack/simple-kernel.js').PublicHex} PublicHex */

export class Kernel extends SimpleKernel {
  /** @type {PvESession} */
  _pve = null
  _pve_hero = write()
  _msg_line = write({ type: 'none' })
  /** @type {BlockID} */
  #selectedChain = null

  /** @type {Modem56} */
  #m56 = null

  constructor (db) {
    super(db)
    this.store.repo.allowDetached = true
    // this.store.register(HeroCPU(() => this.pk))
    this.store.register(MEM_HERO, HeroMemory)
    this.store.register(MEM_LIVE, LiveMemory)
  }

  get session () { return this._pve }

  get $messages () { return this._msg_line[0] }

  get $player () {
    const $blockState = mute(
      s => this.store.on(MEM_HERO, s),
      players => {
        if (!this.#selectedChain) return
        const player = players[toHex(this.#selectedChain)]
        if (!player) return // Create one first
        return upgradePlayer(this.pk, player)
      }
    )
    const c = combine($blockState, this._pve_hero[0])
    return mute(c, ([block, pve]) => pve || block) // prefer virtual PvE-state, remember to clean on commit
  }

  /**
   * Reads arbitrary player from block-store by public key
   * @param {PublicHex} pk
   * @return {Promise<HLHero>}
   */
  async readPlayer (pk) {
    if (!pk) throw new Error('AUTHOR missing')
    const heroMem = this.store.roots[MEM_HERO]
    let chain = await heroMem.lookup(pk)
    if (!chain) throw new Error('Could not resolve key -> Chain<Hero>')
    chain = toHex(chain)
    if (!(await heroMem.hasState(chain))) throw new Error('Unknown Player')
    const player = await heroMem.readState(chain)
    return upgradePlayer(pk, player)
  }

  // godot cannot handle '$' method names nor iterate JS-Arrays
  get on_player () { // but neuro is flexible
    return mute(this.$player, value => JSON.stringify(value))
  }

  get on_message () {
    return mute(this.$messages, value => JSON.stringify(value))
  }

  get on_live_events () {
    return mute(this.$liveEvents, value => JSON.stringify(value))
  }

  /**
   * Spawns a new hero
   * @param {string} name Name of Hero
   * @param {string} memo Shows on death/tombstone
   */
  async createHero (name, memo) {
    const block = await this.createBlock(MEM_HERO, { type: 'spawn_player', name, memo }, new Feed())
    this.#selectedChain = await this.store.roots[MEM_HERO].lookup(this.pk)
    return block
  }

  async beginPVE () {
    const chain = await this.store.roots[MEM_HERO].lookup(this.pk)
    const branch = await this.store.readBranch(chain)
    const psig = branch.last.sig
    // console.log("beginPVE last sig", hexdump(psig))
    // const psig = await this.repo._getHeadPtr(this.pk) // || await this.feed(1).last.sig.toString('hex')

    const cs = get(this.$player)
    if (cs.dead) throw new Error('Hero is Dead')
    this._pve = new PvESession(
      this.pk,
      await sha256(psig),
      cs,
      this._pve_hero[1],
      this._msg_line[1],
      async payload => this.liveStore.update(payload, this._secret)
    )
    return this._pve
  }

  async commitPVE () {
    if (!this._pve) throw new Error('No Active Session')
    const session = this._pve

    const { jobPoints } = computeProgress(session.hero.experience, session.hero.career)
    if (jobPoints !== 0) throw new Error('UnspentJobpoints')

    // try {
    //   const head = await this.repo._getHeadPtr(this.pk);
    //   await this.feed()
    // } catch (err) { debugger }
    const h = session.hero
    /*
    const llh = await this.store.roots[MEM_HERO].readState(this.pk)
    if (!llh) throw new Error('No such hero')
    const p = upgradePlayer(this.pk, llh)
      */
    const p = await this.readPlayer(this.pk)
    const diff = {
      days: 1,
      kills: h.kills - p.kills,
      escapes: h.escapes - p.escapes,
      lvl: h.lvl - p.lvl,
      hp: h.maxhp - p.maxhp,
      pwr: h.stats.pwr - p.stats.pwr,
      agl: h.stats.agl - p.stats.agl,
      wis: h.stats.wis - p.stats.wis,
      experience: h.experience - p.experience,
      refresh_at: nextEntropyRefreshAt(h.spawned, Date.now())
    }

    this._pve = null
    this._pve_hero[1](null) // Flush out session, fall back on store
    // console.log('Precommit outputs', session._rng.outputs)

    const chain = await this.store.roots[MEM_HERO].lookup(this.pk)
    const branch = await this.store.readBranch(chain)
    const block = await this.createBlock(MEM_HERO, { type: 'pve', actions: session.stack }, branch)
    return [diff, block]
  }

  async beginSwarm (Hyperswarm) {
    const topic = 'poh:v0/global'
    this.#m56 = new Modem56(Hyperswarm)
    const leave = await this.#m56.join(topic, this.spawnWire.bind(this), true)
    return leave
  }

  /** @type {LiveMemory} */
  get liveStore () { return this.store.roots[MEM_LIVE] }

  get $liveEvents () {
    return mute(s => this.liveStore.sub(s), async lmem => {
      const out = []
      for (const chain in lmem) {
        const v = lmem[chain]
        const hero = await this.readPlayer(v.AUTHOR).catch(() => null)
        if (!hero) return
        out.push({
          liveChain: chain,
          key: v.AUTHOR,
          name: hero.name,
          state: hero.state,
          spawned: hero.spawned, // Be able to display death counter
          live: v.date,
          location: v.location,
          x: v.x,
          y: v.y,
          says: v.says
        })
      }
      return out
    })
  }
}

function nextEntropyRefreshAt (spawned, seen) {
  const r = 24 * 60 * 60 * 1000
  if (seen === -1) return spawned // Newborn
  return seen + Math.floor((seen - spawned) / r) + r
}
// PvE Gameplay

/**
 * @typedef {{
 *  dead: boolean, spawned: number, seen: number, adventures: number,
 *  name: string, memo: string, state: string, location: number,
 *  kills: number, escapes: number, deaths: number, hp: number,
 *  experience: number, career: string[], inventory: Array<Item|UniqueItem>
 * }} LLHero
 *
 * @typedef { LLHero & {
 *    stats: { pwr: number, agl: number, wis: number, atk: number, def: number, wis: number },
 *    exhaustion: number, xpNext: number, xpRel: number, jobPoints: number, lvl: number,
 *    pwr: number, agl: number, wis: number, profession: string, gender: string,
 *    path: string[], skills: string[], life: number, maxhp: number,
 *    equipment: { left: UniqueItem?, right: UniqueItem?, head: UniqueItem, body: UniqueItem, feet: UniqueItem }
 * }} HLHero
 *
 * PvE Reducer/Slicer/Indexer
 */
class HeroMemory extends Memory {
  /** @type {LLHero} */
  initialValue = {
    AUTHOR: null,
    dead: false, // TODO: probably not needed
    spawned: -1,
    seen: -1,
    adventures: 0, // n-sessions completed
    name: 'unknown',
    memo: 'rip',
    state: 'idle',
    location: 0,
    kills: 0,
    escapes: 0,
    deaths: 0, // life - deaths < 0 == perma death
    hp: 20,
    experience: 0, // Total Experience
    career: [],
    inventory: [
      { id: I.gold, qty: 100 }, // gold
      { id: I.herb, qty: 3 } // Herb
    ]
  }

  idOf ({ CHAIN }) { return CHAIN }

  /** @type {ComputeFunction} */
  async compute (value, ctx) {
    const { payload, reject, date, block, AUTHOR, postpone, index } = ctx
    const { type: blockType } = payload

    if (date > Date.now()) return reject('Block from future') // postpone(date - Date.now()) // TODO: not really implemented, but usecase, use relative/absolute time?

    switch (blockType) {
      case 'spawn_player': {
        if (!block.genesis) return reject('Only genesis blocks can hold spawn_player')
        if (value.spawned !== -1) return reject('Player already spawned')
        const { name, memo } = payload
        if (!name || name === '') return reject('Invalid Hero name')
        // console.log('new hero discovered', AUTHOR, name)
        index(AUTHOR) // Attempting to switch repo into CHAIN mode, create AUTHOR -> Chain<Hero> ptr manually
        return { ...value, AUTHOR, spawned: date, name, memo }
      }

      case 'pve': {
        if (block.genesis) return reject("It's dangerous to adventure without parent")
        const refreshAt = nextEntropyRefreshAt(value.spawned, value.seen)
        if (date < refreshAt) return reject('Attempted to commit too soon')
        if (value.dead) return reject('Hero is Dead')

        const { actions } = payload
        const hero = upgradePlayer(AUTHOR, value)
        // console.log("block.psig", hexdump(block.psig))
        const sess = new PvESession(AUTHOR, await sha256(block.psig), hero)
        await sess.replay(actions) // is async, picostore is sync, shit.
        // console.log('Replay outputs', sess._rng.outputs)
        const dst = clone(value) // TODO: ditch ICE, use clone
        dst.seen = date
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
          'kills',
          'dead'
        ]
        for (const p of propsToCopy) dst[p] = sess.hero[p]
        // console.log('Lowlevel updated', dst)
        return dst
      }
      default:
        throw new Error('unkown_block_type:' + blockType)
    }
  }

  /** @type {ExpiresFunction} */
  expiresAt (hero, latch) {
    const time = hero.status === 'dead'
      ? 3 * 60 * 60 * 1000 // 3 Hours post mortem
      : 7 * 24 * 60 * 60 * 1000 // 1 Week while alive
    return time + hero.seen
  }
}

/** A Temporary memory that is written to during live session.
 * and deleted when session is deleted
 */
class LiveMemory extends Memory {
  /** @typedef { location: number, x: number, y: number, says: string|undefined, date: number } LivePayload */
  initialValue = { location: 0, x: 0, y: 0, says: null, date: -1, AUTHOR: null}
  idOf ({ CHAIN }) { return CHAIN }

  /** @type {ComputeFunction} */
  async compute (value, ctx) {
    const { date, block, index, payload, reject, AUTHOR } = ctx
    if (block.genesis) index(AUTHOR) // Make a ptr to AUTHOR -> Chain<LiveMem>
    return { ...value, ...payload, date, AUTHOR } // TODO: validation
  }

  /**
   * @param {any} payload
   * @param {SecretBin} secret
   */
  async update (payload, secret) {
    const chainPtr = await this.lookup(getPublicKey(secret))
    await this.createBlock(chainPtr, payload, secret)
  }

  expiresAt ({ date }) {
    return date + 3 * 60 * 10000 // 3 minutes
  }
}

/**
 * Converts low-level  player-state into
 * high-level character sheet
 * @param {Bufer|Uint8Buffer} pk Public Key
 * @param {LLHero} state Lowlevel state
 * @return {HLHero}
 */
function upgradePlayer (pk, state) {
  // console.log('UpgradePlayer: ', pk)
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
export async function boot (Hyperswarm, cb) {
  console.log('boot() called, allocating memory')
  const DB = new MemoryLevel('poh.lvl', {
    valueEncoding: 'buffer',
    keyEncoding: 'buffer'
  })
  const kernel = new Kernel(DB)
  await kernel.boot()
  globalThis.K = kernel
  if (Hyperswarm) await kernel.beginSwarm(Hyperswarm)
  if (typeof cb === 'function') cb(kernel)
  return kernel
}

async function sha256 (buffer) {
  return toU8(await globalThis.crypto.subtle.digest('sha-256', au8(buffer)))
}

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

class PvESession {
  started = Date.now()
  /** @type {PRNG} */
  _rng = null
  hero = null
  _notifyChange = null
  stack = []
  #counter_items_spawned = 0
  #battle = null
  /** @typedef {(payload: any) => Promise<void>} UpdateLiveCallback
    * @type {UpdateLiveCallback} */
  #updateLive

  get location () { return this.hero.location }
  get state () { return this.hero.state }
  get area () { return AREAS[this.location] }
  /** @type {Array<Item|UniqueItem>} */
  get inventory () { return this.hero.inventory }
  /** @type {number} */
  get balance () { // gold
    return this.inventory.find(i => i.id === I.gold)?.qty || 0
  }

  /** @type {EquippedView} */
  get equipment () { return viewEquipped(this.inventory) }

  get stats () { return computeStats(this.hero) }

  /** @constructor
   *  @param {PublicBin} author
   *  @param {Uint8Array} seed
   *  @param {LLHero} hero Lowlevel Hero
   *  @param {(hero: any) => void} [onChange] Notifies $player neuron
   *  @param {({ type: string, payload: any }) => void} [sendMessage] Forwarded to Godot/Frontend
   *  @param {UpdateLiveCallback} [updateLive] Generates LiveMem-blocks
   */
  constructor (author, seed, hero, onChange = () => {}, sendMessage = () => {}, updateLive = async () => {}) {
    // console.log('\n==== PvE SEED ====', hexdump(seed))
    this.author = author
    this.hero = clone(hero)
    this._rng = new PRNG(seed, () => this.#rip('Died of exhaustion'))
    this.hero.state = 'adventure'
    this._sendMessage = sendMessage
    this.#updateLive = updateLive

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
    await this.#updateLive({ location: areaId, x: 0.5, y: 0.5 })
  }

  async updateLive (x = 0, y = 0, says = null) {
    return await this.#updateLive({ location: this.location, x, y, says })
  }

  async explore (dungeonId) {
    if (this.state !== 'adventure') throw new Error('Cannot explore while busy')
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
          wis: event.baseStats[2] + spawn.wis,
          description: event.description
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

    const spawnAction = 'attack' // TODO: roll what monster does
    const spawnArg = null

    const baseBonus = await this._rng.randomBytes(1)
    let heroInitiate = hero.agl + (baseBonus & 0b11) // + D4
    let spawnInitiative = spawn.agl + ((baseBonus >> 2) & 0b11) // + D4
    if (action === 'run') heroInitiate += ((baseBonus >> 4) & 0b11) // Bonus = 2D4
    if (spawnAction === 'run') spawnInitiative += ((baseBonus >> 6) & 0b11) // Bonus = 2D4
    const perform = async (action, arg, actor, target) => {
      if (action === 'attack') return attack(actor, target, this._rng)
      if (action === 'cast') return combatCast(actor, arg, target, this._rng)
      if (action === 'run') return attemptEscape(actor, target, this._rng)
      throw new Error('Unknown combat action: ' + action)
    }

    if (heroInitiate > spawnInitiative) {
      const r1 = await perform(action, arg, hero, spawn)
      hits.push(r1)
      const skip = ['kill', 'escaped'].some(t => t === r1.type)
      if (!skip) hits.push(await perform(spawnAction, spawnArg, spawn, hero))
    } else {
      const r1 = await perform(spawnAction, spawnArg, spawn, hero)
      hits.push(r1)
      const skip = ['kill', 'escaped'].some(t => t === r1.type)
      if (!skip) hits.push(await perform(action, arg, hero, spawn))
    }

    for (const hit of hits) hit.own = hit.attacker === hero.name // Is hero attack

    const lastHit = hits[hits.length - 1]
    const type = lastHit.type === 'kill'
      ? (lastHit.own ? 'victory' : 'defeat')
      : lastHit.type === 'escaped'
        ? (lastHit.own ? 'escaped' : 'left_behind') // Implement escapee loses 1 random item from inv
        : 'exchange'

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
      await this.#rip('killed by ' + spawn.name)
      /*
      hero.hp = 10
      hero.deaths++
      hero.location = 0
      hero.state = 'adventure'
      */
    } else if (type === 'escaped' || type === 'left_behind') {
      if (lastHit.own) {
        hero.escapes++
        const items = this.inventory.filter(i => !i.equipped && i.id !== I.gold)
        // There are items to loose
        if (items.length) {
          const lostItem = items.length === 1
            ? items[0]
            : await this._rng.pickOne(items, items.map(() => 1))
          // out.loot.push({ id: lostItem.id, uid: item.uid, qty: 1 })
          out.loot.push({ ...lostItem, qty: 1 })
        }
        // There is gold to loose
        if (this.balance > 0) {
          const qty = Math.min(this.balance, (20 - lastHit.roll)) // TODO: redo this logic
          out.loot.push({ id: I.gold, qty })
          this.removeInventory(out.loot)
        }
      } else {
        const qty = Math.max(this.balance, (20 - lastHit.roll)) // TODO: redo this logic
        out.loot.push({ id: I.gold, qty })
        // TODO: create function rollLoot() and 1 random item drop
        this.addInventory(out.loot)
      }
      hero.state = 'adventure'
    }
    let ding
    try {
      ding = this._levelUp()
    } catch (e) {
      // console.warn('squelching assumed career length error', e)
    }
    if (!ding) this._notifyChange()
    return out
  }

  async #rip(reason) {
    this.hero.dead = true
    this.hero.state = 'rip'
    console.info('__RIP__', reason)
    // TODO: AUTO COMMIT DEATH | KILL SESSION (Rollback day) | INC DEATHS
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
    // console.info('ItemSpawned', instance.uid, instance)
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
        case 'path':
          await this.choosePath(action.job)
          break
        default:
          throw new Error('Unknown PvEAction: ' + action.type)
      }
    }
  }
}

async function attemptEscape (escapee, intimidator, rng) {
  const a = computeStats(escapee)
  const b = computeStats(intimidator)
  let treshold = 10 + b.agl - a.agl
  treshold -= Math.floor(a.pwr / 0.3)
  const hitRoll = await rng.roll(20)
  return hitRoll === 20 || hitRoll >= treshold
    ? { type: 'escaped', attacker: escapee.name, roll: hitRoll }
    : { type: 'escape-failed', attacker: escapee.name, roll: hitRoll }
}

async function combatCast (skill, caster, target, rng) {
  console.warn('combatCast not implemented!', skill, caster, target)
  return { type: 'miss', attacker: caster.name }
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
 * @typdef {{ pwr: number, agl: number, wis: number, atk: number, def: number, mag: number }} Stats
 * @returns {Stats}
 */
function computeStats (character) {
  let { pwr, agl, wis, atk, def, mag } = character // Base Stats
  // Initialize t2 stats (only monsters may have them)
  atk ||= 0
  def ||= 0
  mag ||= 0

  if (Array.isArray(character.inventory)) {
    for (const item of character.inventory) {
      if (item.equipped && item.stats) {
        if (item.stats.pwr) pwr += item.stats.pwr
        if (item.stats.agl) agl += item.stats.agl
        if (item.stats.wis) wis += item.stats.wis
        if (item.stats.atk) atk += item.stats.atk
        if (item.stats.def) def += item.stats.def
        if (item.stats.mag) mag += item.stats.mag
        // TODO: rewrite all hero.maxhp lookups in order to add hp modifier
      }
    }
  }
  atk += pwr + Math.floor(agl * 0.6)
  def += agl + Math.floor(wis * 0.333)
  mag += wis + Math.floor((pwr + agl) * 0.2)
  return { pwr, agl, wis, atk, def, mag }
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
 * @typedef {{ pwr: number, agl: number, wis: number, profession?: string, skills_added: string[], skills_consumed: string[] }} LevelupDiff
 * @param {PublicKey} dna
 * @param {LLHero} hero
 * @returns {undefined|LevelupDiff} levelUp diff
 */
export function levelUp (dna, hero) {
  dna = toU8(dna)
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
