import  { Hero }  from 'binorg/player.js'
import { encode, encodingLength, decode, binstr } from 'binorg/binorg.js'
import { SimpleKernel } from 'picostack'
// import { BrowserLevel } from 'browser-level'
import { MemoryLevel } from 'memory-level'
import { mute, get } from 'piconuro'
// import { pack, unpack } from 'msgpackr'

export class Kernel extends SimpleKernel {
  constructor (db) {
    super(db)
    this.store.register(HeroCPU(() => this.pk))
  }
  get $player () {
    return mute(
      s => this.store.on('players', s),
      (players) => {
        if (!this.pk) return
        const player = players[btok(this.pk)]
        if (!player) return // Create a hero first
        return upgradePlayer(this.pk, player)
      }
    )
  }

  /**
   * Spawns a new hero
   * @param {string} name Name of Hero
   * @param {string} memo Shows on death/tombstone
   */
  async createHero(name, memo) {
    return this.createBlock(null, 'spawn_player', { name, memo })
  }
}

// PvE Gameplay
function HeroCPU (resolveLocalKey) {
  // There's no clean solution in pico for injecting local identity ATM.
  /*
  let _key = null
  const localKey = () => {
    if (_key) return _key
    if (typeof resolveLocalKey === 'function') {
      _key = resolveLocalKey()
      if (!_key) throw new Error('RacingCondition? falsy localKey')
      return _key
    } else throw new Error('resolveLocalKey expected to be function')
  }
  */

  return {
    name: 'players',
    initialValue: {},
    filter({ state, block, parentBlock, AUTHOR }) {
      const key = btok(AUTHOR)
      const data = SimpleKernel.decodeBlock(block.body)
      const { type: blockType } = data
      switch (blockType) {
        case 'spawn_player':
          if (!block.isGenesis) return 'Genesis block required'
          if (state[key]) return 'Player already spawned'
          break
        default:
          return 'unknown block-type'
      }
      return false
    },

    reducer ({ state, block, AUTHOR }) {
      const key = btok(AUTHOR)
      const data = SimpleKernel.decodeBlock(block.body)
      const { type: blockType } = data

      switch (blockType) {
        case 'spawn_player': {
          state[key] = { // mkHero(data)
            spawned: data.date,
            seen: data.date,
            name: data.name,
            memo: data.memo,
            experience: 0,
            career: [ 1 ],
            turns: 30, // + hero.lvl (raw-level) +3 turns each job skill
            turnsUsed: 0,
            inventory: [
              { id: 1, qty: 512 }, // gold
              { id: 60, mods: [] }, // sharp stick
              { id: 30, qty: 3 }, // Herb
            ]
          }
          console.log('new hero discovered', key, state[key].name)
        } break
        default:
          throw new Error('unkown_block_type:' + blockType)
      }
      return { ...state }
    }
  }
}

export function btok (b, length = -1) { // 'base64url' not supported in browser :'(
  if (Buffer.isBuffer(b) && length > 0) {
    b = b.subarray(0, Math.min(length, b.length))
  }
  return b.toString('hex')
}

export function ktob (s) {
  if (typeof s !== 'string') throw new Error('Expected string')
  return Buffer.from(s, 'hex')
}

export function isEqualID (a, b) {
  return (isDraftID(a) && a === b) ||
    (
      Buffer.isBuffer(a) &&
      Buffer.isBuffer(b) &&
      a.equals(b)
    )
}

/**
 * Converts low-level  player-state into
 * high-level character sheet
 * @param {Bufer|Uint8Buffer} pk Public Key
 * @param {any} Lowlevel state
 */
function upgradePlayer (pk, state) {
  const hero = new Hero(null, pk, state.career) // CRYPTOLISK=85*3=256bit, DNA = AUTHOR public key, XP = binary career
  const p = hero.profession
  // Dream exports to godot
  const characterSheet = {
    ...state,
    gender: hero.gender ? 'male' : 'female',
    pwr: hero.pwr,
    agl: hero.agl,
    wis: hero.wis,
    career: p.path,
    career_str: p.originalPath,
    skills: p.skills,
    profession: p.job || 'pleb',
    lvl: hero.lvl,
    life: hero.life,
  }
  return characterSheet
}

async function testBoot () {
  const DB = new MemoryLevel('rant.lvl', {
    valueEncoding: 'buffer',
    keyEncoding: 'buffer'
  })

  const kernel = new Kernel(DB)
  await kernel.boot()
  console.log('k.$player', get(kernel.$player))

  // Create hero
  const block = await kernel.createHero('Bertil VIII', 'A formidable tester without regrets')
  console.log('Hero Created', block)
  console.log('k.$player', get(kernel.$player))

  debugger
}
testBoot().then(() => console.log('test complete')).catch(console.error)
