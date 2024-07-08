/// ITEMS
export const ITEMS = {}
export const INAMES = {}
// FLAGS
const [STACK, SELL, DISCARD, USE] = [0b1, 0b10, 0b100, 0b1000, 0b10000]
const [NONE, LEFT, RIGHT, HEAD, BODY, FEET, TWOHAND] = [0, 1, 2, 3, 4, 5, 6]
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
    equip: opts?.equip || NONE
  }
  if (id in ITEMS) throw new Error(`ERROR: Item "${name}" id collision. ${id} belongs to ${ITEMS[id].name}`)
  ITEMS[id] = item
  INAMES[name.toLowerCase().replace(/\s+/g,'_')] = id
}

defineItem(1, 'Gold', 1, STACK, 'The stuff that gleams')
defineItem(30, 'Herb', 100, STACK | SELL | DISCARD | USE, 'A natural anti-septic')
defineItem(31, 'Fish', 2, STACK | SELL | DISCARD | USE, 'Freshly caught!')
defineItem(60, 'Sharp Stick', 0, SELL | DISCARD, 'You touched the pointy end and discovered that it\'s quite sharp.', {
  equip: RIGHT, pwr: 2
})
defineItem(61, 'Rusty Knife', 10, SELL | DISCARD, 'Will cut through bread if force is applied', {
  equip: RIGHT, pwr: 3, agl: 3
})
defineItem(62, 'Dagger', 20, SELL | DISCARD, 'Standard stab equipment', {
  equip: RIGHT, pwr: 4, agl: 5
})
defineItem(63, 'Short Sword', 80,  SELL | DISCARD, 'Swing it', {
  equip: RIGHT, pwr: 6, agl: 3
})
defineItem(64, 'Flint Spear', 120, SELL | DISCARD, 'Ancient tool, great for hunting', {
  equip: TWOHAND, pwr: 9, agl: 4
})
defineItem(65, 'Mace', 85, SELL | DISCARD, 'Seeing the damage it causes makes you smarter', {
  equip: RIGHT, pwr: 7, agl: -1, wis: 1
})
defineItem(66, 'White Book', 90, SELL | DISCARD, 'Full of tasty cooking recipes, but your opponent doesn\'t know that.', {
  equip: LEFT, pwr: 0, agl: 2, wis: 5
})
defineItem(67, 'Small buckler', 78, SELL | DISCARD, 'Full of tasty cooking recipes, but your opponent doesn\'t know that.', {
  equip: LEFT, pwr: 0, agl: 2, wis: 0, def: 5
})

/// AREAS

export const AREAS = {}
AREAS[0] = {
  id: 0,
  type: 'map',
  name: 'Spawnpoint',
  exits: [1]
}

AREAS[1] = {
  id: 1,
  type: 'map',
  name: 'Crossroads',
  exits: [0, 2, 3, 4], // spawnpoint, town, forest, mountain
  dungeons: [0]
}

/// DUNGEONS

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
        { id: INAMES.gold, chance: 2, qty: 15 },
        { id: INAMES.rusty_knife, chance: 0.1, qty: 1 },
        { id: INAMES.fish, chance: 2, qty: 1 }
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
        { id: INAMES.gold, chance: 2, qty: 8 },
        { id: INAMES.herb, chance: 1, qty: 2 },
        { id: INAMES.fish, chance: 2, qty: 2 }
      ]
    }
  ]
}
