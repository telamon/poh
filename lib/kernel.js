/**
 * TODO: perform repairs,
 * dedupe functionality from core.js
 * run autobase+kernel in parallel
 *
 * Keeping below for reference from original PoH
 * which was running 100% pico
 * ( pico runs in RAM, has zero runtime deps and a slightly different
 * block layout, it predates autobase and designed as an
 * emephereal block-engine to cover hyper*'s tradeoffs )
 * - it's an act of extreme foresight
 *
 */
import { SimpleKernel, Memory, Feed } from 'picostack'
import { toHex, clone, getPublicKey, sha256 } from './lib/util.js'
import { mute, get, write, combine } from 'piconuro'
import { upgradePlayer, PvESession, computeProgress } from './lib/pve.js'
import { I } from './db.js'
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
    // hyperswarm wrapper that meshes with the tiny rpc in simple-kernel
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
 * and deleted when session is deleted,
 * Should be backed by pico
 */
class LiveMemory extends Memory {
  /** @typedef { location: number, x: number, y: number, says: string|undefined, date: number } LivePayload */
  initialValue = { location: 0, x: 0, y: 0, says: null, date: -1, AUTHOR: null }
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
 * TODO: move function to bootloader.js
 * avoid setting globalThis.K in production builds
 */
export async function boot (Hyperswarm, cb) {
  const MemoryLevel = await import('memory-level')
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
