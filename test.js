import test from 'brittle'
import crypto from 'node:crypto'
import PRNG from './lib/prng.js'
import { get, next } from 'piconuro'
import { I, A } from './db.js'
import { typeOf, clone, toHex, cmp } from './lib/util.js'

import FATKernel from './lib/core.js'
import tmp from 'test-tmp'
import Corestore from 'corestore'
import { toU8 } from 'pure-random-number'

// import { JOB_PRIMITIVES } from './player.js'

globalThis.crypto ||= crypto

async function boot (t) {
  const dir = await tmp(t)
  const core = new FATKernel(new Corestore(dir))
  await core.boot()
  return core
}

test('Kernel Boot & Create Character', async t => {
  const kernel = await boot(t)
  const unsub = kernel.on_player(hero => {
    t.comment('hero', hero)
    t.pass('player updated')
  })

  t.absent(get(kernel.$player), 'no hero')

  // Create hero
  const hero = await kernel.createHero('Bertil VIII', 'A formidable tester without regrets')
  t.ok(hero)
  // console.log('Hero Created', hero)

  t.is(typeof get(kernel.on_player), 'string')
  t.is(typeof get(kernel.$player), 'object')
  // console.log('k.on_player', get(kernel.on_player))
  unsub()
})

test('Dissapearing item bug', async t => {
  const kernel = await boot(t)
  await kernel.createHero('Bertil IX', 'Someone who lost his herbs')
  const session = await kernel.beginPVE()
  await session.travelTo(A.crossroads)
  await session.travelTo(A.town)
  // const unsub = kernel.$player(h => t.comment('Inventory', h.inventory))
  await session.interact(0, 'buy', I.ration, 1)
  await session.interact(1, 'buy', I.dagger, 1)

  // const inv = clone(session.hero.inventory)
  t.is(session.inventory.find(({ id }) => I.dagger === id)?.qty, 1, 'should have dagger')
  t.is(session.inventory.find(({ id }) => I.ration === id).qty, 1, 'should have 1 herbs')
  await session.useItem(I.ration)
  t.absent(session.inventory.find(({ id }) => I.ration === id), 'no herbs')
  t.is(session.inventory.find(({ id }) => I.dagger === id)?.qty, 1, 'dagger is still there')
})

test.skip('Levelsystem', async t => {
  const kernel = await boot(t)
  await kernel.createHero('Bertil IX', 'Someone who lost his herbs')
  const session = await kernel.beginPVE()

  // Mocking career/xp works for now in tests,
  // but op fails on all remote peers execution/ breaks your feed.
  session.hero.experience = 35
  await session._notifyChange() // Trigger high-level recalcs

  let h = get(kernel.$player)

  // h.experience => totalXP (LL)
  t.is(h.xpNext, 130, 'Has Relative experience required for next level')
  t.is(h.xpRel, 35, 'Being lvl0 xp = xp')
  t.is(h.jobPoints, 0, 'Zero unused job-points')

  // Story: hero kills craploads of mobs
  session.hero.experience = h.xpNext + 10 // overshoots by 10xp
  await session._notifyChange() // Trigger high-level recalcs

  t.is(session.hero.career.length, 0, 'No career chosen')

  h = get(kernel.$player)
  t.is(h.jobPoints, 1, '1 unspent point') // More than one not supported atm.

  try {
    await kernel.commitPVE()
    t.fail('Broken commit')
  } catch (error) {
    t.is(error.message, 'UnspentJobpoints', 'commitPVE is blocked')
  }
  const dingEvent = next(kernel.$messages, 1)
  const diff = await session.choosePath('M')
  t.alike(diff, { pwr: 1, agl: 0, wis: 0, skills_added: [], skills_consumed: [] }, 'hero level up')
  h = get(kernel.$player)
  t.is(h.jobPoints, 0, 'all points spent')
  t.alike(session.hero.career, ['M'], 'Walking the path of the monk')

  const msg = await dingEvent
  t.is(msg.type, 'level_up')
  t.alike(msg.payload, diff)

  // session.hero.experience +=  662 // overshoots by 10xp
  // const l = await session._levelUp() // Trigger high-level recalcs
  // console.log(l)
})

test('Express gameplay as functions', async t => {
  const kernel = await boot(t)

  await kernel.createHero('Bertil IIX', 'A formidable tester without regrets')

  const session = await kernel.beginPVE()
  // console.log('Session has a character sheet', session.hero)
  t.ok(session.hero, 'hero exported')
  t.ok(session._rng, 'prng present')
  t.is(session.location, 0, 'Player is at spawn point')
  t.alike(session.area.exits, [1], 'Only one way to crossroads')

  await session.travelTo(1) // crossroads
  t.alike(session.area.exits, [0, 2, 3, 4, 7, 9], 'Many exits in crossroads')
  t.alike(session.area.dungeons, [0], 'One dungeon')

  // -- Shopping town/adventure
  await session.travelTo(2) //  Go to town
  // Buy supplies
  await session.interact(1, 'buy', I.rusty_knife, 1)
  const weapon = session.inventory.find(i => i.id === I.rusty_knife)
  t.ok(weapon, 'Bought a knife from the blacksmith')

  await session.interact(0, 'buy', I.ration, 20)
  let food = session.inventory.find(i => i.id === I.ration)
  t.is(food.qty, 20, 'Bought too many rations')
  // Sell some
  await session.interact(0, 'sell', I.ration, 5)
  food = session.inventory.find(i => i.id === I.ration)
  t.is(food.qty, 15, 'sold')

  t.comment('Stats before equip', get(kernel.$player).stats)
  t.ok(!session.equipment.right, 'Nothing equipped')
  await session.useItem(weapon.uid)
  t.is(session.equipment.right.uid, weapon.uid, 'Knife equipped')
  t.comment('Stats after equip', get(kernel.$player).stats)

  await session.useItem(weapon.uid) // unequip
  t.ok(!session.equipment.right, 'Item unequipped')
  await session.useItem(weapon.uid) // unequip
  t.is(session.equipment.right.uid, weapon.uid, 'Knife re-equipped')

  await session.travelTo(1) // Goto crossroads

  const encounter = await session.explore(0)
  t.comment('You encountered', encounter.name)

  let res
  let herbUsed = false
  do {
    if (session.hero.hp < session.hero.maxhp && !herbUsed) {
      herbUsed = true
      t.comment('Trying out combat-use herb')
      const hpBefore = session.hero.hp
      await session.useItem(I.herb)
      t.not(hpBefore, session.hero.hp, 'Combat use herb')
    }
    res = await session.doBattle('attack')
    // res => { type: 'exchange', you: 'hit|miss|run', they: 'hit|miss|run', dmgGiven: 3, dmgTaken: 2 }
    t.comment('Battle round', res.type, session.hero.hp, encounter.hp, res.hits.map(h => h.type))
  } while (res.type === 'exchange')
  if (res.type === 'defeat') console.log('we died, rerun test')
  else {
    t.is(res.type, 'victory', 'winrar!')
    t.ok(res.xp > 10)
    // t.ok(res.loot?.length > 0)
    t.comment('Looted n_items:', res.loot?.length)
  }

  if (session.hero.hp < session.hero.maxhp) {
    t.comment('HP post battle', session.hero.hp)
    const hpBefore = session.hero.hp
    await session.useItem(I.ration)
    t.not(hpBefore, session.hero.hp, 'Heal up After battle')
  } else t.pass('HP is full, ration test skipped')

  // await session.travelTo(2)
  // await sesion.npcAction('1', 'identify', inventoryIndexOfItem)

  const heroCopy = clone(get(kernel.$player)) // Get player as seen during PvE-sesh

  await kernel.commitPVE()
  t.pass('PvE Complete. going to sleep')

  // Test Determinism
  t.comment('========== REPLAY ===========')
  const hero = await kernel.readPlayer(kernel.writerKey) // Safe to read hero because sleeping in blockstore

  // Computed props are not candidates for determinism
  heroCopy.seen = hero.seen // last-block-date
  heroCopy.adventures++ // adventure count increased
  heroCopy.state = 'idle' // sleeping
  heroCopy.exhaustion = hero.exhaustion // Should always be reset
  heroCopy.hp = hero.hp // Wounds heal on sleep
  console.log('comparison', compare(hero, heroCopy, true))
  // t.alike(hero, heroCopy, 'PvECPU is Deterministic')
})

test('PRNG', async t => {
  const seed = crypto.randomBytes(32)
  const rng = new PRNG(seed)
  while (rng.rounds < 1) await rng.roll(20)
  // t.comment(rng.outputs.length, rng)
  const b = new PRNG(seed)
  await b.replay(rng.inputs)
  t.alike(rng.outputs, b.outputs, 'Deterministic outputs')
})

test.skip('Live PvE store', async t => {
  const kernel = await boot(t)
  await kernel.createHero('Bertil IX', 'Someone who lost his herbs')
  const session = await kernel.beginPVE()
  await session.travelTo(A.crossroads)
  await session.travelTo(A.town)
  await session.updateLive(0.25, 0.7, 'Hello')
  await session.updateLive(0.25, 0.7, 'Is anyone here?')
  // kernel.$player(h => console.log('Inventory', h.inventory))
  const worldState = await next(kernel.on_live_events, 0)
  await session.updateLive(0.25, 0.7, 'wtf?')
  console.log(worldState)
})

function compare (a, b, onlyDiff = false, depth = 0) {
  function eql (a, b) {
    if (typeOf(a) === 'u8') return cmp(toU8(a), toU8(b))
    return a === b
  }
  function inspect (o) {
    if (typeOf(o) === 'u8') return toHex(toU8(o))
    return JSON.stringify(o)
  }
  const indent = n => Array.from(new Array(n)).map(() => '  ').join('')
  if (typeOf(a) !== typeOf(b)) return `${inspect(a)} != ${inspect(b)}\n`

  if (typeOf(a) === 'array' || typeOf(a) === 'object') {
    let out = ''
    const keys = []
    for (const k in a) if (keys.indexOf(k) === -1) keys.push(k)
    for (const k in b) if (keys.indexOf(k) === -1) keys.push(k)
    for (const k of keys) {
      const diff = compare(a[k], b[k], onlyDiff, depth + 1)
      if (diff) out += indent(depth + 1) + `${k}: ` + diff
    }
    return out.length
      ? (Array.isArray(a) ? '[\n' : '{\n') + out + indent(depth) + (Array.isArray(a) ? ']\n' : '}\n')
      : null
  }

  if (!onlyDiff && eql(a, b)) return `${inspect(a)} == ${inspect(b)}\n`
  else if (!eql(a, b)) return `${inspect(a)} != ${inspect(b)}\n`
}

test('Z-order Curve 3D', async t => {
  const vec3 = [12n, 15n, 256n]
  const n = encode64ZOC3(...vec3)
  t.alike(decode64ZOC3(n), vec3)
  t.is(encodeVZOC3(vec3, 64), n)
  t.alike(decodeVZOC3(n, 64), vec3)
})

// https://en.wikipedia.org/wiki/Z-order_curve
function encode64ZOC3 (x, y, z) {
  if (Array.isArray(x)) { z = x[2]; y = x[1]; x = x[0] }
  x = spread3(x)
  y = spread3(y)
  z = spread3(z)
  return (z << 2n) | (y << 1n) | x
}

// Morton decode function
function decode64ZOC3 (code) {
  const x = compact3(code)
  const y = compact3(code >> 1n)
  const z = compact3(code >> 2n)
  return [x, y, z]
}

function spread3 (n) {
  n = BigInt(n) & 0x1fffffn // Mask input to 21 bits
  n = (n | (n << 32n)) & 0x1f00000000fffffn
  n = (n | (n << 16n)) & 0x1f0000ff0000ffn
  n = (n | (n << 8n)) & 0x100f00f00f00f00fn
  n = (n | (n << 4n)) & 0x10c30c30c30c30c3n
  n = (n | (n << 2n)) & 0x1249249249249249n
  return n
}

function compact3 (n) {
  n = BigInt(n) & 0x1249249249249249n
  n = (n ^ (n >> 2n)) & 0x10c30c30c30c30c3n
  n = (n ^ (n >> 4n)) & 0x100f00f00f00f00fn
  n = (n ^ (n >> 8n)) & 0x1f0000ff0000ffn
  n = (n ^ (n >> 16n)) & 0x1f00000000fffffn
  n = (n ^ (n >> 32n)) & 0x1fffffn
  return n
}

function encodeVZOC3 (x, y, z, bits) {
  if (Array.isArray(x)) { bits = y; z = x[2]; y = x[1]; x = x[0] }
  x = BigInt(x)
  y = BigInt(y)
  z = BigInt(z)
  let o = 0n
  for (let i = 0n; i < bits; i++) {
    const bitmask = 1n << i
    const xi = (x & bitmask) << (2n * i)
    const yi = (y & bitmask) << (2n * i + 1n)
    const zi = (z & bitmask) << (2n * i + 2n)
    o |= xi | yi | zi
  }
  return o
}

function decodeVZOC3 (code, bits) {
  let x = 0n; let y = 0n; let z = 0n
  for (let i = 0n; i < bits; i++) {
    x |= ((code >> (3n * i)) & 1n) << i
    y |= ((code >> (3n * i + 1n)) & 1n) << i
    z |= ((code >> (3n * i + 2n)) & 1n) << i
  }
  return [x, y, z]
}
