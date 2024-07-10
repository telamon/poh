import test from 'tape'
import crypto from 'node:crypto'
import { boot, PRNG, clone } from './index.js'
import { get, settle, next } from 'piconuro'
import { I } from './db.js'
globalThis.crypto ||= crypto

test('Kernel Boot & Create Character', async t => {
  const kernel = await boot()
  console.log('k.on_player', get(kernel.on_player))
  // Create hero
  const block = await kernel.createHero('Bertil VIII', 'A formidable tester without regrets')
  console.log('Hero Created', block)
  console.log('k.on_player', get(kernel.on_player))
  t.equal(typeof get(kernel.on_player), 'string')
  t.equal(typeof get(kernel.$player), 'object')
})

test.only('Express gameplay as functions', async t => {
  const kernel = await boot()
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
  t.ok(session.inventory.find(i => i.id === I.rusty_knife), 'Bought a knife from the blacksmith')

  await session.interact(0, 'buy', I.ration, 20)
  let food = session.inventory.find(i => i.id === I.ration)
  t.equal(food.qty, 20, 'Bought too many rations')
  // Sell some
  await session.interact(0, 'sell', I.ration, 5)
  food = session.inventory.find(i => i.id === I.ration)
  t.equal(food.qty, 15, 'sold')

  await session.travelTo(1) // Goto crossroads
  console.log(session.area)
  const encounter = await session.explore(0) // -> ++RNG, 1turn used, fuck... state.
  console.log('You encountered', encounter)
  let res
  do {
    res = await session.doBattle('attack')
    // res => { type: 'exchange', you: 'hit|miss|run', they: 'hit|miss|run', dmgGiven: 3, dmgTaken: 2 }
    console.log('Battle round', res, session.hero.hp, encounter.hp)
  } while (res.type === 'exchange')
  if (res.type === 'defeat') console.log('we died, rerun test')
  else {
    t.equal(res.type, 'victory', 'winrar!')
    t.ok(res.xp > 10)
    t.ok(res.loot?.length > 0)
  }

  // await session.travelTo(2)
  // await sesion.npcAction('1', 'identify', inventoryIndexOfItem)

  const heroCopy = clone(get(kernel.$player))
  // const unsub = kernel.$player(p => console.info('Sub update', p))
  await kernel.commitPVE(session)
  // unsub()

  // Test Determinism
  const hero = await next(settle(kernel.$player), 0) // Picostore needs to support async block-processing
  heroCopy.seen = hero.seen // last-block-date
  heroCopy.adventures++ // adventure count increased
  heroCopy.state = 'idle' // sleeping
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
