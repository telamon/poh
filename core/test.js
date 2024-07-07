import test from 'tape'
import crypto from 'node:crypto'
globalThis.crypto ||= crypto
import { boot } from './index.js'
import { get } from 'piconuro'

test('Kernel Boot & Create Character', async t => {
  const kernel = await boot()
  console.log('k.on_player', get(kernel.on_player))
  // Create hero
  const block = await kernel.createHero('Bertil VIII', 'A formidable tester without regrets')
  console.log('Hero Created', block)
  console.log('k.on_player', get(kernel.on_player))
  t.ok(get(kernel.on_player))

  const d20 = await kernel._roll(20)
  console.log('Test CSPRNG dice', d20, kernel._actionBuffer)
  t.ok(d20 > 0 && d20 < 21, 'D20 rolled')
  t.equal(kernel._actionBuffer.length, 1, 'Roll logged to transaction buffer')


  debugger
})
