// const inspect = require('inspect-custom-symbol')
import { Binorg, CRYPTORG, mapOverlap } from './binorg.js'

export class Hero extends Binorg {
  constructor (m = CRYPTORG, d, x) {
    super(m, d, x)
  }

  get gender () {
    const pad = mapOverlap([this.dna], ([d], stop) => {
      // TODO: a little bit unintuitive, maybe redesign later.
      stop()
      // Stop requests to stop the loop "after" finished processing
      // this bit index for ALL pads, (e.g. on iteration complete)
      return d // <-- this is always the returned value mapOverlap()
    })
    return !!pad[0]
  }

  get profession () {
    let path = this._career()
      .map(i => JOB_PRIMITIVES[i])

    const originalPath = path.join('')
    path = evolve(path, JOB_RULES)

    return {
      path,
      job: path[0], // .match(/[A-Z][a-z]+/g).join(', '),
      skills: [],
      originalPath
    }
  }

  _career () {
    const path = []
    let nBits = 0
    let tmp = 0
    mapOverlap([this.dna, this.exp], ([d, x]) => {
      tmp = tmp | ((d ^ x) << nBits % 3)
      nBits++
      if (!(nBits % 3)) { // We've hit an octet
        path.push(tmp)
        tmp = 0
      }
    })
    return path
  }

  inspect () {
    let s = ''
    const p = this.profession
    s += `  ${this.gender ? 'male' : 'female'} [${p.job}]\n`
    s += `  Skills:\n    ${p.skills.join('\n    ')}\n`
    s += `  Path: ${p.path}\n`
    s += `  RawPath: ${p.originalPath}\n`
    /*
    s += '  Aggregation:\n    ' + p.aggregation
      .map((n, j) => jobsTier1[j] + ' x' + n)
      .join('\n    ')
      */
    return s
  }
}

// flat binary tree.
// const jobs = ['0', '1', '00', '01', '10', '11', '000', '001', '010', '011', '100', '101', '110', '111']
// jobs[0b1001 - 2] // => '001'
export const JOB_PRIMITIVES = [
  'A', // 'Amateur', // Generalist/Versatile
  'W', // 'Warrior', // Specialist
  'R', // 'Ranger', // Specialist
  'M', // 'Monk', // Hybrid
  'S', // 'Sorcerer', // Specialist
  'P', // 'Paladin', // Hybrid
  'D', // 'Dancer', // Hybrid, Bard?
  'F' // 'Farmer' // Cursed Villager?
]

// Operates on arrays of tokens, if tokens in pattern are contained by
// tokens in input, then they are replaced with tokens in replacement.
// If pattern is not contained by input, then unmodified input is returned.
export function rewrite (input, pattern, replacement) {
  const pool = [...input]
  if (typeof pattern === 'string') pattern = pattern.split('')
  for (const chr of pattern) {
    const idx = pool.findIndex((elem, n) =>
      (chr instanceof RegExp) ? elem.match(chr) : chr === elem
    )
    if (!~idx) return input // idx: -1, no match; return original input
    else pool.splice(idx, 1) // remove match from pool and continue to next token
  }
  if (!Array.isArray(replacement)) replacement = [replacement]
  return [...pool, ...replacement]
}

// Recursivly rewrites an array with rules until it stops changing.
export function evolve (mem, rules = JOB_RULES) {
  let n = 0
  let prev = null
  do {
    prev = mem
    for (const rule of rules) mem = rewrite(mem, rule[0], rule[1])
    if (mem.join() === prev.join()) n++
  } while (n < 2)
  return mem
}

export function regrow (mem, rules) {
  return mem.reduce((buf, elem) => {
    return evolve([...buf, elem], rules)
  })
}

// Array helper, returns array of length N filled with E
export function A (e, n) { return Array.from(new Array(n)).map(_ => e) }

// L-system replacements expressed as: [ pattern,  replacement]
export const JOB_RULES = [
  // Upgrade acolyte skills when reaching next tier
  [['Sorcerer', 'Heat'], ['Sorcerer', 'Ignite']],
  [['Sorcerer', 'Chill'], ['Sorcerer', 'Wind']],
  // Discover healing element
  [['Protect', 'Breeze'], ['Protect', 'breeze', 'Recover']]
]

const jobs = [
  // Tier 1
  makeJob('Warrior', 'WWW', 'W', 'Punch', 'Bash'),
  makeJob('Hunter', 'RRR', 'R', 'Throw', 'Stab'),
  makeJob('Brawler', 'MMM', 'M', 'Kick', 'Grapple'),
  makeJob('Adventurer', 'AAA', 'A', 'Math', 'Endurance'),
  makeJob('Acolyte', 'SSS', 'S', 'Heat', 'Breeze'),
  makeJob('Pleb', 'FFF', 'F', 'Run', 'Hide'),
  makeJob('Paladin', 'PPP', 'P', 'Protect', 'Shield'),
  makeJob('Dancer', 'DDD', 'D', 'Rhythm', 'Feint'),

  // Tier 2
  makeJob('Berserker', ['Warrior', 'warrior_lvl_MAX', 'W'], 'W', 'Rage', 'Headbutt'),
  makeJob('Marksman', ['Hunter', 'hunter_lvl_MAX', 'R'], 'R', 'Aim', 'Weakness'),
  makeJob('Sorcerer', ['Acolyte', 'acolyte_lvl_MAX', 'S'], 'S', 'Freeze', 'Telekinesis'),
  makeJob('Villager', ['Pleb', 'pleb_lvl_MAX', 'F'], 'F', 'Tinker', 'Gamble'),
  makeJob('Monk', ['Brawler', 'brawler_lvl_MAX', 'M'], 'M', 'Jump', 'Uppercut'),

  // Tier 2.5 cross-breeds
  makeJob('Wardancer', ['Berserker', 'berserker_lvl_0', 'Dancer', 'dancer_lvl_0'], ['W', 'D'], 'Whirl', 'Lunge'),
  // TODO: Upgrade existing W/D skills for each level as compensation for slow progress rate

  // Tier 3
  // emerging pattern seems to be CC, AoE, Nuke
  makeJob('Slayer', ['Berserker', 'berserker_lvl_MAX', 'W'], 'W', 'Intimidate', 'Cleave', 'Decapitate'),
  makeJob('Sniper', ['Marksman', 'marksman_lvl_MAX', 'R'], 'R', 'Longshot', 'Barrage', 'Ritochet'),
  makeJob('Mesmer', ['Dancer', 'dancer_lvl_MAX', 'D'], 'D', 'Distract', 'Sweep', 'Charm'),
  makeJob('Taoist', ['Monk', 'monk_lvl_max', 'M'], 'M', 'Redirect', 'Roundhouse', 'Soulblade') // Maybe Taoist is crossover between monk&sorerer?

  /*
   * unused skills:
   * Tackle, Lacerate, Parry, Feint, Stab, Dodge, Aim, Shield, Sunder,
   * Balance, Redirect, Wrestle, Charm, Math, Endurance, Philosophy,
   * Firebolt, Fireball, Sidestep, cold-touch, windblade, wind, Flyckick
   * Recover, Plant, Holy, Charge, Slash
  */
  // Skills should morph the same way clasess, do, classes aquire skils.
  // makeSkill('Backstab', ['Stab', 'Hide'])
]

export function makeJob (name, prereq, progressToken, ...skills) {
  if (!Array.isArray(progressToken)) progressToken = [progressToken]
  const lvlToken = `${name.toLowerCase()}_lvl_`
  let level = 0
  const evoRule = [prereq, [name, lvlToken + level]]
  const progressRules = []
  for (const skill of skills) {
    progressRules.push([
      [name, lvlToken + level, ...progressToken], // pattern
      [name, lvlToken + (++level), skill] // replacement
    ])
  }
  if (level) progressRules.push([[lvlToken + level], lvlToken + 'MAX'])
  else evoRule[1].push(lvlToken + 'MAX')
  return {
    evolution: evoRule,
    progression: progressRules
  }
}
// prepend the generated job-rules
for (const j of jobs) JOB_RULES.unshift(...j.progression)
for (const j of jobs) JOB_RULES.unshift(j.evolution)
