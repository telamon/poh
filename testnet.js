import Hyperswarm from 'hyperswarm'
import crypto from 'node:crypto'
import { boot } from './index.js'
import { I, A, ITEMS, E } from './db.js'
import { settle, until } from 'piconuro'
import { JOB_PRIMITIVES } from './player.js'
import { argv0 } from 'node:process'
globalThis.crypto ||= crypto
const DROPS = {}
const ENCOUNTERS = {}

async function main () {
  const SWARM = true
  const NUMBER = 4
  const SPEED = 5

  const peers = []
  for (let i = 0; i < NUMBER; i++) {
    peers.push(
      spawnBot(`ROB${i}:x${Math.ceil(Math.random() * 256).toString(16)}`, SWARM, SPEED)
    )
  }
  let error
  let stati
  try {
    stati = await Promise.all(peers)
    console.log('exits', stati)
    const sagg = { died: 0, sleep: 0 }
    for (const exit of stati) sagg[exit]++
    console.table(sagg)
    console.log('Rate of survival: ', sagg.sleep / sagg.died)
  } catch (err) {
    error = err
  }

  console.log('Encounters')
  console.table(agg(ENCOUNTERS))
  console.log('Droprates')
  console.table(agg(DROPS))
  if (error) {
    console.log('Aborted by error', error)
    process.exit(1)
  }
  return stati
}
main()


/**
 * @typedef {import('./index.js').Kernel} Kernel
 * @param {Kernel} kernel */
export async function runSession (kernel, log, speed = 1) {
  const session = await kernel.beginPVE()
  await session.travelTo(A.crossroads)
  await session.travelTo(A.town)
  await session.interact(1, 'buy', I.dagger, 1)
  await session.interact(0, 'buy', I.ration, 10)
  // const weapon = session.inventory.find(i => i.id === I.dagger)
  // await session.useItem(weapon.uid)
  await session.travelTo(A.crossroads)
  log('weapon aquired, gone adventuring')
  const sleep = t => new Promise((resolve) => setTimeout(resolve, t * speed))
  // let hero = null
  // const unsub = kernel.$player(h => { hero = h })
  while (true) {
    const hero = await until(settle(kernel.$player, 150), v => !!v) // TODO: un-async $player neuron, it's broken!
    const { exhaustion, xpRel, lvl, hp, maxhp, jobPoints, inventory, equipment } = hero
    const balance = inventory.find(i => i.id === I.gold)?.qty || 0
    // console.log(hero)
    log('===============================================')
    log(`[${session.state}]> Lv:`, lvl, 'HP:', hp, 'Exp:', xpRel, 'Gold:', balance, 'Exhaust:', exhaustion)
    if (hero.dead) return 'died'
    switch (session.state) {
      case 'adventure': {
        // This is the part i fail as a human
        const unequipped = inventory.filter(i => i.uid && !i.equipped)
        if (unequipped.length) {
          for (const item of unequipped) {
            const { uid, stats } = item
            const spec = session._getItemSpec(item.id)
            const { equip } = spec
            let current
            if (equip & E.RIGHT) current ||= equipment.right
            else if (equip & E.LEFT) current ||= equipment.left
            else if (equip & E.HEAD) current ||= equipment.head
            else if (equip & E.BODY) current ||= equipment.body
            else if (equip & E.FEET) current ||= equipment.feet
            // try { Object.values(stats) } catch (err) { debugger } // detect bugged equipment
            // Unweighted stats
            const currentStat = current
              ? Object.values(current.stats).reduce((s, n) => s + n, 0)
              : 0
            const itemStat = Object.values(stats).reduce((s, n) => s + n, 0)
            if (itemStat > currentStat) {
              log('🏹equipping!', spec.name, currentStat, '=>', itemStat)
              await session.useItem(uid)
              continue
            }
          }
        }

        if (jobPoints) {
          const job = JOB_PRIMITIVES[Math.floor(Math.random() * JOB_PRIMITIVES.length)]
          log('🎉Job lvl up!', job)
          await session.choosePath(job)
          await session.updateLive(Math.random(), Math.random(), 'I think I\'ll go with ' + job)
          continue
        }

        if (exhaustion > 900) {
          const [diff] = await kernel.commitPVE()
          const eq = Object.values(equipment).map(i => i && session._getItemSpec(i.id).name).join(' | ')
          log('😴 Zzz', { ...diff, eq })
          return 'sleep'
        }
        const food = hero.inventory.find(i => [I.ration, I.fish].indexOf(i.id) !== -1)
        if (hp < maxhp - 5) {
          if (food?.qty) {
            await session.useItem(food.id)
            log('🍖eating...', food.id, food.qty)
            await session.updateLive(Math.random(), Math.random(), 'I think I\'ll have lunch')
            continue
          } else if (balance > 5 * 3) {
            log('🛍️ have money, gone shopping')
            await session.updateLive(Math.random(), Math.random(), 'That hurt, I\'m leaving')
            await session.travelTo(A.town)
            await session.interact(0, 'buy', I.ration, 5)
            await session.travelTo(A.crossroads)
            await session.updateLive(Math.random(), Math.random(), 'Adventure time!')
            continue
          }
        }
        if (session.location !== A.crossroads) await session.travelTo(A.crossroads)
        const encounter = await session.explore(0)
        log(`⚔️ Encounter! ${encounter.name} Lv${encounter.lvl}`)
        ENCOUNTERS[encounter.name] ||= 0
        ENCOUNTERS[encounter.name]++
      } break
      case 'battle': {
        if (hp < 7) {
          const herb = session.inventory.find(i => i.id === I.herb)
          if (herb?.qty) {
            log('🌿 battle recovery', herb.qty)
            await session.useItem(I.herb)
          } else {
            log('🏃running away')
            await session.doBattle('run')
          }
        } else {
          const res = await session.doBattle('attack')
          const { type, hits, spawn } = res
          log(spawn.name, type, spawn.hp, hits.map(({ type, damage, own }) => `${own ? '➡️' : '⬅️'} ${type} ${damage || ''}`).join('\t|\t'))
          if (type === 'victory') {
            for (const i of res.loot) {
              DROPS[ITEMS[i.id].name] ||= 0
              DROPS[ITEMS[i.id].name]++
            }
            log('🪙 victory', res.loot.map(i => `${i.qty}x${ITEMS[i.id].name}`))
            await session.updateLive(Math.random(), Math.random(), 'I won! ' + spawn.name + ' is no more')
            await sleep(1000)
          } else if (type === 'defeat') {
            log('💀killed by', spawn.name)
            continue
          }
        }
        break
      }
      default: throw new Error('UnknownState: ' + session.state)
    }
    await sleep(500)
  }
}
export async function spawnBot (name = 'Robotron', swarm = false, speed = 1) {
  const log = (...args) => console.info(name, ...args)
  log('booting')
  const kernel = await boot(swarm ? Hyperswarm : null)
  await kernel.createHero(name, 'I am robot')
  log('booted & created')

  const exit = await runSession(kernel, log, speed)
  // await kernel.stopSwarm()
  return exit
}

function agg (counts) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  const out = {}
  for (const key in counts) {
    out[key] = ((counts[key] / total) * 100).toFixed(2) + '%'
  }
  return out
}
