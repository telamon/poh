import Autobee from 'autobee'
import { Router, encode } from '../spec/hyperdispatch/index.js'
import { PvESession, upgradePlayer, computeProgress } from './pve.js'
import { I } from '../db.js'
import N from 'piconuro'
import { au8, sha256, clone, toHex, fromHex, cmp, toU8 } from './util.js'
import { encode as pack, decode as unpack } from 'cborg'

/** @typedef {import('hypercore')} Hypercore */
/** @typedef {*} PrivateApplyCalls */

// TODO: Rework this interface
// for picostore/Memory::ComputeFunction compat
/** @typedef {{
 host: PrivateApplyCalls,
 view: *,
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

const DEFAULT_WORLD_KEY = fromHex('8b2405c07692deb492d4151e0a4f140c2ee03630b3cad586a4112c6437e1958d') // sha256('poh:v1/kryptonia')
const DEFAULT_WORLD_TOPIC = fromHex('5432714beeda360d5a7e52764b1e0b3b1a03bcf0723c8e9c0d582fb6c89b114f') // sha256(DEFAULT_WORLD_KEY)
const PLAYER_PREFIX = Buffer.from('player!')

export async function deriveWorldTopic (worldKey) {
  return sha256(toU8(worldKey))
}

export default class Core {
  router = new Router()

  _stores = {
    update: write(),
    hero: write(),
    pveHero: write(),
    pveMessageLine: write()
  }

  constructor (store, opts = {}) {
    this.store = store
    this._worldTopic = au8(toU8(opts.worldTopic || DEFAULT_WORLD_TOPIC), 32)
    this._bootstrap = opts.bootstrap || null

    // no chaos no game
    // this.bootstrap = opts.bootstrap || null

    this.base = new Autobee(this.store, this._bootstrap, {
      optimistic: true,

      apply: this._apply.bind(this),
      update: this._onUpdate.bind(this)
    })

    // setup reducers

    this.router.add('@honor/spawn-player', applySpawnPlayer)
    this.router.add('@honor/pve-session', applyPvE)
    this.router.add('@honor/pve-session-v2', applyPvE)
  }

  /** @type {Hypercore} */
  get core () { return this.base.local }
  /** @type {Uint8Array} */
  get key () { return this.base.key }
  /** @type {Uint8Array} */
  get discoveryKey () { return this.base.discoveryKey }
  /** @type {Uint8Array} */
  get worldTopic () { return this._worldTopic }
  /** @type {Uint8Array} */
  get defaultWorldKey () { return DEFAULT_WORLD_KEY }
  /** @type {Uint8Array} */
  get writerKey () { return this.core.key }
  /** @type {Uint8Array} */
  get pk () { return this.writerKey }
  get view () { return this.base.view }

  get $messages () { return this._stores.pveMessageLine[0] }

  async boot () {
    await this.base.ready()
    await this._onUpdate()
  }

  async _onUpdate () {
    // setup ram-stores
    const [, setUpdate] = this._stores.update
    const [, setHero] = this._stores.hero

    if (this.base._interrupting) return
    setUpdate(Date.now())

    const key = this.pk
    const player = await this.readPlayer(key)
    if (player) setHero(player)
  }

  async _apply (nodes, view, host) {
    for (const node of nodes) {
      const author = node.key
      /** @type {ApplyContext} */
      const ctx = {
        view,
        host,
        author,
        node,
        from: this.base.openCore(node.key),
        seq: node.length
      }
      await this.router.dispatch(node.value, ctx)
    }
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
    }), this._appendOpts())

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
    const view = this.base.view
    const player = await getPlayer(view, key)

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
      debugger // eslint-disable-line no-debugger
      throw new Error('invalid seed')
    }

    this._pve = null
    this._stores.pveHero[1](null) // Flush out session, fall back on store

    const refreshed = next(this.$player, 1)

    await this.base.append(encode('@honor/pve-session-v2', {
      date: Date.now(),
      actions: pack(session.stack)
    }), this._appendOpts())

    await refreshed

    return diff
  }

  async addRemote (key) {
    await this.base.wakeup({ key })
  }

  _appendOpts () {
    return this.base.writable ? {} : { optimistic: true }
  }

  async listPlayers (opts = {}) {
    const players = []
    for await (const llhero of findPlayers(this.view, opts)) {
      players.push(upgradePlayer(llhero.key, llhero))
    }
    return players
  }
}

function rejectBlock (...reason) {
  throw new Error('Block Rejected')
}

/** @param {ApplyContext} context */
async function applySpawnPlayer (data, context) {
  const { host, view, node, author, seq } = context

  if (!cmp(data.key, author)) return rejectBlock('Misleading player key', toHex(data.key), toHex(author))

  const value = await getPlayer(view, author)
  if (value) return rejectBlock('player already exists, prev:', value)
  if (seq !== 1) return rejectBlock('non-genesis spawn, seq:', seq)

  if (node.optimistic) await host.addWriter(node.key)
  await putPlayer(view, author, data)
}

/** @param {ApplyContext} context */
async function applyPvE (data, context) {
  const { view, node, author, seq, from, host } = context
  const { date } = data

  const psig = await from.treeHash(seq - 1)

  const value = await getPlayer(view, author)

  if (!value) return rejectBlock("It's dangerous to adventure without parent")

  const refreshAt = nextEntropyRefreshAt(value.spawned, value.seen)

  if (date < refreshAt) return rejectBlock('Attempted to commit too soon')
  if (value.dead) return rejectBlock('Hero is Dead')

  const actions = unpack(data.actions)

  const hero = upgradePlayer(author, value)

  const seed = await sha256(psig)

  const sess = new PvESession(author, seed, hero)
  try {
    await sess.replay(actions) // is async, picostore is sync, shit.
  } catch (err) {
    debugger // eslint-disable-line no-debugger
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

  if (node.optimistic) await host.ackWriter(node.key)
  await putPlayer(view, author, dst)
  // console.log('Lowlevel updated', dst)
}

function playerKey (key) {
  return Buffer.concat([PLAYER_PREFIX, Buffer.from(toU8(key))])
}

async function getPlayer (view, key) {
  const node = await view.get(playerKey(key))
  return node ? unpack(node.value) : null
}

async function putPlayer (view, key, player) {
  const w = view.write()
  w.tryPut(playerKey(key), pack(player))
  await w.flush()
}

async function * findPlayers (view) {
  for await (const node of view.createReadStream()) {
    if (!startsWith(node.key, PLAYER_PREFIX)) continue
    yield unpack(node.value)
  }
}

function startsWith (buf, prefix) {
  if (buf.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (buf[i] !== prefix[i]) return false
  }
  return true
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
