import Hyperswarm from 'hyperswarm'
import Autobase from 'autobase'
import HyperDB from 'hyperdb'
import { Router, encode } from '../spec/hyperdispatch/index.js'
import db from '../spec/db/index.js'
import { PvESession, upgradePlayer, computeProgress } from './pve.js'
import { I } from '../db.js'
import N from 'piconuro'
import { sha256, clone, toHex } from './util.js'
import { encode as pack, decode as unpack } from 'cborg'

/** @typedef {import('autobase/lib/apply-calls.js').PrivateApplyCalls} PrivateApplyCalls */
/** @typedef {{
 base: PrivateApplyCalls,
 view: HyperDB,
 key: Buffer,
 node: undefined,
}} ApplyContext */

const {
  mute,
  write,
  next,
  get,
  combine
} = N

const MEM_HERO = '@honor/players'

export default class FatKernel {
  router = new Router()

  _stores = {
    update: write(),
    hero: write(),
    pveHero: write(),
    pveMessageLine: write()
  }

  constructor (store, opts = {}) {
    this.store = store
    this.bootstrap = opts.bootstrap || null

    this.base = new Autobase(this.store, opts.key, {
      open: store => HyperDB.bee(store.get('view'), db, {
        extension: false,
        autoUpdate: true
      }),
      apply: this._apply.bind(this)
    })

    // setup reducers

    this.router.add('@honor/spawn-player',
      /** @param {ApplyContext} context */
      async function applySpawnPlayer (data, context) {
        const { base, view } = context
        await base.addWriter(data.key)
        await view.insert(MEM_HERO, data)
      }
    )

    this.router.add('@honor/pve-session', applyPvE)
  }

  get key () { return this.base.key }
  get discoveryKey () { return this.base.discoveryKey }
  get writerKey () { return this.base.local.key }

  async boot () {
    await this.base.ready()

    // setup ram-stores
    const [, setUpdate] = this._stores.update
    const [, setHero] = this._stores.hero

    this.base.on('update', async () => {
      if (this.base._interrupting) return
      setUpdate(Date.now())

      const key = this.writerKey
      const player = await this.readPlayer(key)
      if (player) setHero(player)
    })
  }

  async _apply (nodes, view, base) {
    for (const node of nodes) {
      const key = node.from.key
      await this.router.dispatch(node.value, { view, base, key, node })
    }

    await view.flush()
  }

  get $player () {
    const $blockState = this._stores.hero[0]
    const c = combine($blockState, this._stores.pveHero[0])
    return mute(c, ([block, pve]) => pve || block) // prefer virtual PvE-state, remember to clean on commit
  }

  // godot cannot handle '$' method names nor iterate JS-Arrays
  get on_player () { // but neuro is flexible
    return mute(this.$player, value =>
      value && JSON.stringify({ ...value, key: toHex(value.key) })
    )
  }

  async createHero (name, memo) {
    if (!this.key) throw new Error('not ready')

    const refreshed = next(this.$player, 1)

    await this.base.append(encode('@honor/spawn-player', {
      ...initHero(),
      key: this.writerKey,
      spawned: Date.now(),
      seen: 0,
      name,
      memo
    }))

    return refreshed
  }

  async beginPVE () {
    if (!this.base.writable) throw new Error('core not writable')

    /** @type {import('hypercore')} */
    const core = this.base.local
    const psig = await core.treeHash()

    const cs = get(this.$player)

    this._pve = new PvESession(
      this.pk,
      await sha256(psig),
      cs,
      this._stores.pveHero[1],
      this._stores.pveMessageLine[1],
      async payload => {} // this.liveStore.update(payload, this._secret)
    )

    return this._pve
  }

  async readPlayer (key) {
    /** @type {HyperDB} */
    const view = this.base.view
    const player = await view.get(MEM_HERO, { key })

    if (player) return upgradePlayer(key, player)
  }

  async commitPVE () {
    if (!this._pve) throw new Error('No Active Session')
    const session = this._pve

    const { jobPoints } = computeProgress(session.hero.experience, session.hero.career)
    if (jobPoints !== 0) throw new Error('UnspentJobpoints')

    const h = session.hero
    /*
    const llh = await this.store.roots[MEM_HERO].readState(this.pk)
    if (!llh) throw new Error('No such hero')
    const p = upgradePlayer(this.pk, llh)
      */
    const p = await this.readPlayer(this.writerKey)
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
    this._stores.pveHero[1](null) // Flush out session, fall back on store
    // console.log('Precommit outputs', session._rng.outputs)

    const refreshed = next(this.$player, 1)

    await this.base.append(encode('@honor/pve-session', {
      date: Date.now(),
      actions: pack(session.stack)
    }))

    await refreshed

    return diff
  }

  async beginSwarm (Hyperswarm) {
    const topic = 'poh:v0/global'
    // this.#m56 = new Modem56(Hyperswarm)
    // const leave = await this.#m56.join(topic, this.spawnWire.bind(this), true)
    return // leave
  }
}

/** @param {ApplyContext} context */
async function applyPvE (data, context) {
  function reject (msg) { throw new Error(msg) }

  const { view, node, key } = context
  const { date } = data
  /** @type {import('hypercore')} */
  const from = node.from
  const psig = await from.treeHash()

  const value = await view.get(MEM_HERO, { key })

  if (!value) return reject("It's dangerous to adventure without parent")

  const refreshAt = nextEntropyRefreshAt(value.spawned, value.seen)

  if (date < refreshAt) return reject('Attempted to commit too soon')
  // if (value.dead) return reject('Hero is Dead')

  const actions = unpack(data.actions)

  const hero = upgradePlayer(key, value)

  const sess = new PvESession(key, await sha256(psig), hero)
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

  await view.insert(MEM_HERO, dst)
  // console.log('Lowlevel updated', dst)
}

function initHero () {
  return {
    // AUTHOR: null,
    spawned: -1,
    seen: 0,
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
}

function nextEntropyRefreshAt (spawned, seen) {
  const r = 24 * 60 * 60 * 1000
  if (seen === 0) return spawned // Newborn
  return seen + Math.floor((seen - spawned) / r) + r
}
