/**
 * @param {number} id
 * @param {string} name
 * @param {number} vendorPrice
 * @param {number} caps
 * @param {string} description
 * @param {any} opts
 */
function defineItem (id, name, vendorPrice, caps, description, opts = {}) {
  const item = {
    id,
    name,
    description,
    vendorPrice,
    stacks: !!(caps & STACK),
    sells: !!(caps & SELL),
    discards: !!(caps & DISCARD),
    usable: !!(caps && USE),
    usableCombat: !!(caps && USE_COMBAT),
    equip: opts?.equip || NONE
  }

  if (opts?.equip) {
    item.stats = { pwr: opts.pwr || 0, dex: opts.dex || 0, wis: opts.wis || 0 }
  }

  if (id in ITEMS) throw new Error(`ERROR: Item "${name}" id collision. ${id} belongs to ${ITEMS[id].name}`)
  ITEMS[id] = item
  I[name.toLowerCase().replace(/\s+/g, '_')] = id
}

/**
 * Returns a deconstruct friendly sequence of numbers
 * where with increasing shift in first bit: (0b1, 0b010, 0b100...)
 * @param {number} n Amount of values to generate
 */
function bitEnum (n) {
  if (!Number.isSafeInteger(1 << n)) throw new Error('OutOfBits')
  return Array.from(new Array(n)).map((_, ordinal) => 1 << ordinal)
}
function mkEnum(n) { return Array.from(new Array(n)).map(_, i => i) }

/// --------------------------------------
/// ITEMS
/// --------------------------------------
export const ITEMS = {}
export const I = {} // ITEM NAMES

// FLAGS
const [STACK, SELL, DISCARD, USE, USE_COMBAT] = bitEnum(5)
const NONE = 0
const [LEFT, RIGHT, HEAD, BODY, FEET] = bitEnum(5)
const TWOHAND = LEFT | RIGHT

defineItem(1, 'Gold', 1, STACK, 'The stuff that gleams')
defineItem(30, 'Herb', 100, STACK | SELL | DISCARD | USE, 'A natural anti-septic with relaxing properties')
defineItem(31, 'Ration', 2, STACK | SELL | DISCARD | USE, 'Restores health, when out of combat')
defineItem(32, 'Fish', 2, STACK | SELL | DISCARD | USE, 'Freshly caught!')
defineItem(60, 'Sharp Stick', 0, SELL | DISCARD, 'You touched the pointy end and confirmed that it\'s quite sharp.', {
  equip: RIGHT, pwr: 2
})
defineItem(61, 'Rusty Knife', 10, SELL | DISCARD, 'Will cut through bread if force is applied', {
  equip: RIGHT, pwr: 3, agl: 3
})
defineItem(62, 'Dagger', 20, SELL | DISCARD, 'Standard stabbing equipment', {
  equip: RIGHT, pwr: 4, agl: 5
})
defineItem(63, 'Short Sword', 80, SELL | DISCARD, 'Swing it', {
  equip: RIGHT, pwr: 6, agl: 3
})
defineItem(64, 'Flint Spear', 120, SELL | DISCARD, 'Ancient tool, great for hunting', {
  equip: TWOHAND, pwr: 9, agl: 4
})
defineItem(65, 'Mace', 85, SELL | DISCARD, 'Seeing the damage makes you smarter', {
  equip: RIGHT, pwr: 7, agl: -1, wis: 1
})
defineItem(66, 'White Book', 90, SELL | DISCARD, 'Full of tasty cooking recipes, but your opponent doesn\'t know that.', {
  equip: LEFT, pwr: 0, agl: 2, wis: 5
})
defineItem(67, 'Small buckler', 78, SELL | DISCARD, 'Will deflect an arrow if held at an approriate angle', {
  equip: LEFT, pwr: 0, agl: 2, wis: 0, def: 5
})

/// --------------------------------------
/// AREAS
/// --------------------------------------

const A = Object.freeze({ // ANames
  spawn: 0,
  crossroads: 1,
  town: 2,
  forest: 3,
  mountain: 4,
  swamp: 5,
  citadel: 6,
  sewers: 7,
  underground_village: 8,
  farm: 9,
  plains_desolation: 10
})

export const AREAS = {}
AREAS[A.spawn] = {
  id: A.spawn,
  type: 'map',
  name: 'Spawnpoint',
  exits: [A.crossroads]
}

AREAS[A.crossroads] = {
  id: A.crossroads,
  type: 'map',
  name: 'Crossroads',
  exits: [A.spawn, A.town, A.forest, A.mountain, A.sewers, A.farm], // spawnpoint, town, forest, mountain
  dungeons: [0]
}

AREAS[A.town] = {
  id: A.town,
  type: 'town', // not sure what the difference is?
  name: 'Townspring',
  exits: [A.crossroads, A.citadel],
  npcs: [
    { // TODO: considering moving out into own NPCS section
      id: 0,
      name: 'General Store',
      sells: [
        I.ration,
        I.herb,
        I.rusty_knife,
        I.white_book
      ]
    },
    {
      id: 1,
      name: 'Blacksmith',
      sells: [
        I.rusty_knife,
        I.dagger,
        I.small_buckler,
        I.short_sword,
        I.mace
      ]
    }
  ]
}

AREAS[A.forest] = {
  id: A.forest,
  type: 'map',
  name: 'Crossroads',
  exits: [A.crossroads, A.swamp], // spawnpoint, town, forest, mountain
  dungeons: [1]
}

/// --------------------------------------
/// DUNGEONS
/// --------------------------------------

export const DUNGEONS = {}
DUNGEONS[0] = {
  id: 0,
  name: 'Plains around crossroads',
  encounters: [
    {
      type: 'monster',
      name: 'Tiny Goblin',
      chance: 2,
      baseStats: [4, 3, 1],
      lvl: { min: 3, max: 7 },
      hp: 7,
      xp: 10,
      // option: barter
      loot: [
        { id: I.gold, chance: 2, qty: 15 },
        { id: I.rusty_knife, chance: 1, qty: 1 },
        { id: I.fish, chance: 2, qty: 1 }
      ]
    },
    {
      type: 'monster',
      name: 'Green Slime',
      chance: 3,
      baseStats: [2, 1, 4],
      lvl: { min: 2, max: 5 },
      hp: 10,
      xp: 15,
      // option: barter
      loot: [
        { id: I.gold, chance: 2, qty: 8 },
        { id: I.herb, chance: 1, qty: 2 },
        { id: I.fish, chance: 2, qty: 2 },
        { id: I.mace, chance: 1, qty: 1 }
      ]
    }
  ]
}
