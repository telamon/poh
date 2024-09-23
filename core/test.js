import test from 'tape'
import crypto from 'node:crypto'
import { boot, PRNG, clone } from './index.js'
import { get, next } from 'piconuro'
import { I, A } from './db.js'
import { fromHex } from 'picofeed'
// import { JOB_PRIMITIVES } from './player.js'
import { typeOf } from '@telamon/picostore'

globalThis.crypto ||= crypto

test('Kernel Boot & Create Character', async t => {
  const kernel = await boot()
  console.log('k.on_player', get(kernel.on_player))
  // Create hero
  const block = await kernel.createHero('Bertil VIII', 'A formidable tester without regrets')
  // console.log('Hero Created', block)
  console.log('k.on_player', get(kernel.on_player))
  t.equal(typeof get(kernel.on_player), 'string')
  t.equal(typeof get(kernel.$player), 'object')
})

test('Dissapearing item bug', async t => {
  const kernel = await boot()
  await kernel.createHero('Bertil IX', 'Someone who lost his herbs')
  const session = await kernel.beginPVE()
  await session.travelTo(A.crossroads)
  await session.travelTo(A.town)
  kernel.$player(h => console.log('Inventory', h.inventory))
  await session.interact(0, 'buy', I.ration, 1)
  await session.interact(1, 'buy', I.dagger, 1)

  // const inv = clone(session.hero.inventory)
  t.equal(session.inventory.find(({ id }) => I.dagger === id)?.qty, 1, 'should have dagger')
  t.equal(session.inventory.find(({ id }) => I.ration === id).qty, 1, 'should have 1 herbs')
  await session.useItem(I.ration)
  t.notOk(session.inventory.find(({ id }) => I.ration === id), 'no herbs')
  t.equal(session.inventory.find(({ id }) => I.dagger === id)?.qty, 1, 'dagger is still there')
})

test.skip('Levelsystem', async t => {
  const kernel = await boot()
  await kernel.createHero('Bertil IX', 'Someone who lost his herbs')
  const session = await kernel.beginPVE()

  // Mocking career/xp works for now in tests,
  // but op fails on all remote peers execution/ breaks your feed.
  session.hero.experience = 35
  await session._notifyChange() // Trigger high-level recalcs

  let h = get(kernel.$player)

  // h.experience => totalXP (LL)
  t.equal(h.xpNext, 130, 'Has Relative experience required for next level')
  t.equal(h.xpRel, 35, 'Being lvl0 xp = xp')
  t.equal(h.jobPoints, 0, 'Zero unused job-points')

  // Story: hero kills craploads of mobs
  session.hero.experience = h.xpNext + 10 // overshoots by 10xp
  await session._notifyChange() // Trigger high-level recalcs

  t.equal(session.hero.career.length, 0, 'No career chosen')

  h = get(kernel.$player)
  t.equal(h.jobPoints, 1, '1 unspent point') // More than one not supported atm.

  try {
    await kernel.commitPVE()
    t.fail('Broken commit')
  } catch (error) {
    t.equal(error.message, 'UnspentJobpoints', 'commitPVE is blocked')
  }
  const dingEvent = next(kernel.$messages, 1)
  const diff = await session.choosePath('M')
  t.deepEqual(diff, { pwr: 1, agl: 0, wis: 0, skills_added: [], skills_consumed: [] }, 'hero level up')
  h = get(kernel.$player)
  t.equal(h.jobPoints, 0, 'all points spent')
  t.deepEqual(session.hero.career, ['M'], 'Walking the path of the monk')

  const msg = await dingEvent
  t.equal(msg.type, 'level_up')
  t.deepEqual(msg.payload, diff)

  // session.hero.experience +=  662 // overshoots by 10xp
  // const l = await session._levelUp() // Trigger high-level recalcs
  // console.log(l)
})

test('Express gameplay as functions', async t => {
  const kernel = await boot()
  // console.log('===> Secret', toHex(kernel._secret))
  kernel._secret = fromHex('05e3a8f6653c508ff39d6a086f86b89cce21f4083c8b9f3c0f7d5c5f9f938e97') // Lock prng for this test

  await kernel.createHero('Bertil IIX', 'A formidable tester without regrets')
  /** @type {require('./index.js').PvESession} */
  const session = await kernel.beginPVE()
  console.log('Session has a character sheet', session.hero)
  t.ok(session.hero, 'hero exported')
  t.ok(session._rng, 'prng present')
  t.equal(session.location, 0, 'Player is at spawn point')
  t.deepEqual(session.area.exits, [1], 'Only one way to crossroads')

  await session.travelTo(1) // crossroads
  t.deepEqual(session.area.exits, [0, 2, 3, 4, 7, 9], 'Many exits in crossroads')
  t.deepEqual(session.area.dungeons, [0], 'One dungeon')

  // -- Shopping town/adventure
  await session.travelTo(2) //  Go to town
  // Buy supplies
  await session.interact(1, 'buy', I.rusty_knife, 1)
  const weapon = session.inventory.find(i => i.id === I.rusty_knife)
  t.ok(weapon, 'Bought a knife from the blacksmith')

  await session.interact(0, 'buy', I.ration, 20)
  let food = session.inventory.find(i => i.id === I.ration)
  t.equal(food.qty, 20, 'Bought too many rations')
  // Sell some
  await session.interact(0, 'sell', I.ration, 5)
  food = session.inventory.find(i => i.id === I.ration)
  t.equal(food.qty, 15, 'sold')

  console.log('Stats before', get(kernel.$player).stats)
  t.notOk(session.equipment.right, 'Nothing equipped')
  await session.useItem(weapon.uid)
  t.equal(session.equipment.right.uid, weapon.uid, 'Knife equipped')
  console.log('Stats after', get(kernel.$player).stats)

  await session.useItem(weapon.uid) // unequip
  t.notOk(session.equipment.right, 'Item unequipped')
  await session.useItem(weapon.uid) // unequip
  t.equal(session.equipment.right.uid, weapon.uid, 'Knife reequipped')

  await session.travelTo(1) // Goto crossroads
  console.log(session.area)
  const encounter = await session.explore(0) // -> ++RNG, 1turn used, fuck... state.
  console.log('You encountered', encounter)
  console.log(JSON.stringify(encounter))
  let res
  let herbUsed = false
  do {
    if (session.hero.hp < session.hero.maxhp && !herbUsed) {
      herbUsed = true
      console.log('Trying out combat-use herb')
      const hpBefore = session.hero.hp
      await session.useItem(I.herb)
      t.notEqual(hpBefore, session.hero.hp, 'Combat use herb')
    }
    res = await session.doBattle('attack')
    // res => { type: 'exchange', you: 'hit|miss|run', they: 'hit|miss|run', dmgGiven: 3, dmgTaken: 2 }
    console.log('Battle round', res.type, session.hero.hp, encounter.hp, res.hits.map(h => h.type))
  } while (res.type === 'exchange')
  if (res.type === 'defeat') console.log('we died, rerun test')
  else {
    t.equal(res.type, 'victory', 'winrar!')
    t.ok(res.xp > 10)
    // t.ok(res.loot?.length > 0)
    console.info('Looted n_items:', res.loot?.length)
  }

  if (session.hero.hp < session.hero.maxhp) {
    console.log('HP post battle', session.hero.hp)
    const hpBefore = session.hero.hp
    await session.useItem(I.ration)
    t.notEqual(hpBefore, session.hero.hp, 'Heal up After battle')
  } else t.pass('HP is full, ration test skipped')

  // await session.travelTo(2)
  // await sesion.npcAction('1', 'identify', inventoryIndexOfItem)

  const heroCopy = clone(get(kernel.$player)) // Get player as seen during live
  // const unsub = kernel.$player(p => console.info('Sub update', p))
  await kernel.commitPVE()
  t.pass('Going to sleep')
  // unsub()
  console.log('========== REPLAY ===========')
  // Test Determinism
  const hero = await kernel.readPlayer(kernel.pk) // Safe to read hero because sleeping in blockstore

  // Computed props are not candidates for determinism
  heroCopy.seen = hero.seen // last-block-date
  heroCopy.adventures++ // adventure count increased
  heroCopy.state = 'idle' // sleeping
  heroCopy.exhaustion = hero.exhaustion // Should always be reset
  heroCopy.hp = hero.hp // Wounds heal on sleep
  console.log('comparison', compare(hero, heroCopy, true))
  t.deepEqual(hero, heroCopy, 'PvECPU is Deterministic')
})

test('PRNG', async t => {
  const seed = crypto.randomBytes(32)
  const rng = new PRNG(seed)
  while (rng.rounds < 1) await rng.roll(20)
  console.log(rng.outputs.length, rng)
  const b = new PRNG(seed)
  await b.replay(rng.inputs)
  t.deepEqual(rng.outputs, b.outputs, 'Deterministic outputs')
})

test('Live PvE store', async t => {
  const kernel = await boot()
  await kernel.createHero('Bertil IX', 'Someone who lost his herbs')
  const session = await kernel.beginPVE()
  await session.travelTo(A.crossroads)
  await session.travelTo(A.town)
  await session.updateLive(0.25, 0.7, 'Hello')
  await session.updateLive(0.25, 0.7, 'Is anyone here?')
  // kernel.$player(h => console.log('Inventory', h.inventory))
  const worldState = await next(kernel.on_live(), 0)
  await session.updateLive(0.25, 0.7, 'wtf?')
  console.log(worldState)
})

function compare (a, b, onlyDiff = false, depth = 0) {
  const indent = n => Array.from(new Array(n)).map(() => '  ').join('')
  if (typeOf(a) !== typeOf(b)) return `${JSON.stringify(a)} != ${JSON.stringify(b)}\n`
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

  if (!onlyDiff && a === b) return `${a} == ${b}\n`
  else if (a !== b) return `${a} != ${b}\n`
}

test.only('Z-order Curve 3D', async t => {
  const vec3 = [12n, 15n, 256n]
  const n = encode64ZOC3(...vec3)
  t.deepEqual(decode64ZOC3(n), vec3)
  t.equal(encodeVZOC3(vec3, 64), n)
  t.deepEqual(decodeVZOC3(n, 64), vec3)
})

// https://en.wikipedia.org/wiki/Z-order_curve
function encode64ZOC3(x, y, z) {
  if (Array.isArray(x)) { z = x[2]; y = x[1]; x = x[0] }
  x = spread3(x);
  y = spread3(y);
  z = spread3(z);
  return (z << 2n) | (y << 1n) | x;
}

// Morton decode function
function decode64ZOC3(code) {
  const x = compact3(code)
  const y = compact3(code >> 1n)
  const z = compact3(code >> 2n)
  return [x, y, z]
}

function spread3(n) {
  n = BigInt(n) & 0x1fffffn // Mask input to 21 bits
  n = (n | (n << 32n)) & 0x1f00000000fffffn
  n = (n | (n << 16n)) & 0x1f0000ff0000ffn
  n = (n | (n << 8n))  & 0x100f00f00f00f00fn
  n = (n | (n << 4n))  & 0x10c30c30c30c30c3n
  n = (n | (n << 2n))  & 0x1249249249249249n
  return n
}

function compact3(n) {
  n = BigInt(n) & 0x1249249249249249n
  n = (n ^ (n >> 2n))  & 0x10c30c30c30c30c3n
  n = (n ^ (n >> 4n))  & 0x100f00f00f00f00fn
  n = (n ^ (n >> 8n))  & 0x1f0000ff0000ffn
  n = (n ^ (n >> 16n)) & 0x1f00000000fffffn
  n = (n ^ (n >> 32n)) & 0x1fffffn
  return n
}

function encodeVZOC3(x, y, z, bits) {
  if (Array.isArray(x)) { bits = y; z = x[2]; y = x[1]; x = x[0] }
  x = BigInt(x);
  y = BigInt(y);
  z = BigInt(z);
  let o = 0n;
  for (let i = 0n; i < bits; i++) {
    let bitmask = 1n << i;
    let xi = (x & bitmask) << (2n * i);
    let yi = (y & bitmask) << (2n * i + 1n);
    let zi = (z & bitmask) << (2n * i + 2n);
    o |= xi | yi | zi;
  }
  return o;
}

function decodeVZOC3(code, bits) {
  let x = 0n, y = 0n, z = 0n;
  for (let i = 0n; i < bits; i++) {
    x |= ((code >> (3n * i)) & 1n) << i;
    y |= ((code >> (3n * i + 1n)) & 1n) << i;
    z |= ((code >> (3n * i + 2n)) & 1n) << i;
  }
  return [ x, y, z ];
}
