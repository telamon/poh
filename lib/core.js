import Autobase from 'autobase'
import HyperDB from 'hyperdb'
import { Router, encode } from '../spec/hyperdispatch/index.js'
import db from '../spec/db/index.js'
import { PvESession, upgradePlayer, computeProgress } from './pve.js'
import { I } from '../db.js'
import N from 'piconuro'
import { sha256, clone, toHex, fromHex, s2b, cmp, toU8 } from './util.js'
import { encode as pack, decode as unpack } from 'cborg'

/** @typedef {import('hypercore')} Hypercore */
/** @typedef {import('autobase/lib/apply-calls.js').PrivateApplyCalls} PrivateApplyCalls */

// TODO: Rework this interface
// for picostore/Memory::ComputeFunction compat
/** @typedef {{
 host: PrivateApplyCalls,
 view: HyperDB,
 author: Buffer,
 from: Hypercore,
 seq: number,
 node: undefined,
}} ApplyContext */

const {
  mute,
  write,
  next,
  get,
  combine
} = N

const BASE_TOPIC = fromHex('2a4b2ab0b53b0cc8d63cf9d4d4be79e5a232ded033f7669f697847ea7e0cda98') // sha256('poh:v1/global')
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

    // no chaos no game
    // this.bootstrap = opts.bootstrap || null

    this.base = new Autobase(this.store, BASE_TOPIC, {
      optimistic: true,

      open: store => HyperDB.bee(store.get('view'), db, {
        // extension: false,
        autoUpdate: true
      }),

      apply: this._apply.bind(this)
    })

    // setup reducers

    this.router.add('@honor/spawn-player', applySpawnPlayer)
    this.router.add('@honor/pve-session', applyPvE)
  }

  /** @type {Hypercore} */
  get core () { return this.base.local }
  /** @type {Uint8Array} */
  get key () { return this.base.key }
  /** @type {Uint8Array} */
  get discoveryKey () { return this.base.discoveryKey }
  /** @type {Uint8Array} */
  get writerKey () { return this.core.key }
  /** @type {Uint8Array} */
  get pk () { return this.writerKey }
  /** @type {HyperDB} */
  get view () { return this.base.view }

  get $messages () { return this._stores.pveMessageLine[0] }

  async boot () {
    await this.base.ready()

    // setup ram-stores
    const [, setUpdate] = this._stores.update
    const [, setHero] = this._stores.hero

    this.base.on('update', async () => {
      if (this.base._interrupting) return
      setUpdate(Date.now())

      const key = this.pk
      const player = await this.readPlayer(key)
      if (player) setHero(player)
    })
  }

  async _apply (nodes, view, host) {
    for (const node of nodes) {
      const author = node.from.key
      /** @type {ApplyContext} */
      const ctx = {
        view,
        host,
        author,
        node,
        from: node.from,
        seq: node.length
      }
      await this.router.dispatch(node.value, ctx)
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
      key: this.pk,
      spawned: Date.now(),
      seen: 0,
      name,
      memo
    }), { optimistic: true })

    return refreshed
  }

  async beginPVE () {
    if (!this.core.writable) throw new Error('core not writable')

    const psig = await this.core.treeHash()
    const seed = await sha256(psig)

    const cs = get(this.$player)

    this._pve = new PvESession(
      this.pk,
      seed,
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

    const p = await this.readPlayer(this.pk)
    if (!p) throw new Error('No such hero')

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

    const seed = this._pve._rng._base

    const psig = await this.core.treeHash()
    const iseed = await sha256(psig)

    if (!cmp(toU8(seed), toU8(iseed))) {
      debugger
      throw new Error('invalid seed')
    }

    this._pve = null
    this._stores.pveHero[1](null) // Flush out session, fall back on store

    const refreshed = next(this.$player, 1)

    await this.base.append(encode('@honor/pve-session', {
      date: Date.now(),
      actions: pack(session.stack),
      // DEBUG
      seed,
      author: this.writerKey,
      seq: this.core.length + 1
    }), { optimistic: true })

    await refreshed

    return diff
  }

  replicate (isInitator, opts = {}) {
    return this.base.replicate(isInitator, opts)
  }

  async beginSwarm (Hyperswarm, topic = null, verbose = true) {
    if (Hyperswarm === 'true') Hyperswarm = await import('hyperswarm')

    const discoveryKey = topic
      ? await sha256(s2b(topic)) // this.discoveryKey
      : BASE_TOPIC

    this.swarm = new Hyperswarm()

    const onconnection = (connection, peerInfo) => {
      if (verbose) console.error('peer connected', peerInfo.publicKey?.toString('hex').slice(0, 7))
      this.replicate(connection)
    }

    this.swarm.on('connection', onconnection)

    this.swarm.join(discoveryKey, { server: true, client: true })
    // await swarm.flush()

    const unswarm = async () => {
      this.swarm.off('connection', onconnection)
      return this.swarm.destroy()
    }

    this.base.once('close', unswarm)

    return unswarm
  }

  async listPlayers (opts = {}) {
    const players = []
    for await (const llhero of this.view.find(MEM_HERO, opts)) {
      players.push(upgradePlayer(llhero.key, llhero))
    }
    return players
  }
}

function rejectBlock (...reason) {
  console.error('Block Rejected:', ...reason)
  throw new Error('Block Rejected')
}

/** @param {ApplyContext} context */
async function applySpawnPlayer (data, context) {
  const { host, view, node, author, seq } = context

  const value = await view.get(MEM_HERO, { key: author })
  if (value) return rejectBlock('player already exists, prev:', value)
  if (seq !== 1) return rejectBlock('non-genesis spawn, seq:', seq)

  if (node.optimistic) await host.ackWriter(node.from.key)
  await view.insert(MEM_HERO, data)
}

/** @param {ApplyContext} context */
async function applyPvE (data, context) {
  const { view, node, author, seq, from, host } = context
  const { date, author: _author, seq: _seq, seed: _seed } = data

  if (!cmp(_author, author)) return rejectBlock('Misleading author', toHex(_author), toHex(author))
  if (_seq !== seq) return rejectBlock('Misleading sequence', _seq, seq)

  const psig = await from.treeHash(seq - 1)

  const value = await view.get(MEM_HERO, { key: author })

  if (!value) return rejectBlock("It's dangerous to adventure without parent")

  const refreshAt = nextEntropyRefreshAt(value.spawned, value.seen)

  if (date < refreshAt) return rejectBlock('Attempted to commit too soon')
  if (value.dead) return rejectBlock('Hero is Dead')

  const actions = unpack(data.actions)

  const hero = upgradePlayer(author, value)

  const seed = await sha256(psig)
  if (!cmp(_seed, seed)) return rejectBlock('Misleading seed', _seed, seed)

  const sess = new PvESession(author, seed, hero)
  try {
    await sess.replay(actions) // is async, picostore is sync, shit.
  } catch (err) {
    debugger
    return rejectBlock('replay threw', err)
  }

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

  if (node.optimistic) await host.ackWriter(node.from.key)
  await view.insert(MEM_HERO, dst)
  // console.log('Lowlevel updated', dst)
}

function initHero () {
  return {
    // AUTHOR: null,
    dead: false,
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
