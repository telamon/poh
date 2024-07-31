export const A = Object.freeze({ // Area Names
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

/**
 * @param {number} id
 * @param {string} name
 * @param {number} vendorPrice
 * @param {number} caps
 * @param {string} description
 * @param {any} opts
 */
function defineItem (id, name, vendorPrice, caps, description, opts = {}) {
  const type = opts?.equip
    ? 'equipment'
    : (caps & (USE | USE_COMBAT))
        ? 'consumable'
        : 'commodity'
  const subType = type === 'equipment'
    ? (opts.equip & TWOHAND) ? 'weapon' : 'armor'
    : opts.type
  const ALL_CAPS = STACK | SELL | DISCARD | USE | USE_COMBAT | NONE
  if (caps & ~ALL_CAPS) {
    const unk = caps & ~ALL_CAPS
    throw new Error(`Unknown capability ${unk}, 0b${unk.toString(2)}`)
  }
  const item = {
    id,
    type,
    subType,
    name,
    description,
    vendorPrice,
    // Unpack flags
    stacks: !!(caps & STACK),
    sells: !!(caps & SELL),
    discards: !!(caps & DISCARD),
    usable: !!(caps & USE),
    usableCombat: !!(caps & USE_COMBAT),
    equip: opts?.equip || NONE
  }

  if (type === 'equipment') {
    item.stats = {
      pwr: opts.pwr || 0,
      agl: opts.agl || 0,
      wis: opts.wis || 0,
      atk: opts.atk || 0,
      def: opts.def || 0,
      mag: opts.mag || 0
    }
  }
  if (type === 'consumable') item.effect = opts.effect
  if (id in ITEMS) throw new Error(`ERROR: Item "${name}" id collision. ${id} belongs to ${ITEMS[id].name}`)
  ITEMS[id] = item
  I[name.toLowerCase().replace(/\s+/g, '_').replace(/'/g, '')] = id
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
export function mkEnum (n) { return Array.from(new Array(n)).map((_, i) => i) }

/** @typedef {{ type: string }} Effect
  * @type {(number, string, number, string, Effect, boolean) => void} */
function defConsumable (id, name, price, desc, effect, combatUse = false) {
  return defineItem(id, name, price, STACK | SELL | DISCARD | USE | (combatUse ? USE_COMBAT : 0), desc, { effect })
}
/** @returns {Effect} heal effect structure */
const fxHeal = (amount, bonus = 0) => ({ type: 'heal', amount, bonus })
const fxEscape = (amount, bonus = 0) => ({ type: 'escape', amount, bonus })
/// --------------------------------------
/// ITEMS
/// --------------------------------------
export const ITEMS = {}
export const I = {} // ITEM NAMES // TODO: convert to error throwing LatchProxy when using nonexisting name

// FLAGS
const [STACK, SELL, DISCARD, USE, USE_COMBAT] = bitEnum(5)
const NONE = 0
const [LEFT, RIGHT, HEAD, BODY, FEET] = bitEnum(5)
const TWOHAND = LEFT | RIGHT
export const E = { NONE, LEFT, RIGHT, HEAD, BODY, FEET, TWOHAND }

/** defineItem(itemId: number, name: string, price: number, capabilities: uint, description: string, props: any) */
defineItem(1, 'Gold', 1, STACK, 'The stuff that gleams')

defConsumable(30, 'Herb', 100, 'A natural anti-septic with relaxing properties', fxHeal(6, 5), true)
defConsumable(31, 'Ration', 2, 'Restores health, when out of combat', fxHeal(3))
defConsumable(32, 'Fish', 2, 'Freshly caught!', fxHeal(3))
defConsumable(83, 'Red Potion', 250, 'Restores a moderate amount of health immediately.', fxHeal(20, 10), true)
defConsumable(84, 'Smokebomb', 40, 'When you have to, you have to', fxEscape(6, 12))

// defineItem(5, '')
// equipmentItem(7, 'The legendary sword de')
defineItem(6, 'Hypercore',0 , STACK, 'It is said that at least two of them are consumed\nwhen enchanting an item with dimensional space-time properties.\nThe details were lost when the book of xorcery was burned, so nowadays they\'re just a gimmick.')

// TODO: rewrite to defEq(id, name, price, slot, description, stats= {})
defineItem(60, 'Sharp Stick', 0, SELL | DISCARD, 'You touched the pointy end and confirmed that it\'s quite sharp.', {
  equip: RIGHT, pwr: 2
})
defineItem(61, 'Rusty Knife', 10, SELL | DISCARD, 'Will cut through bread if force is applied', {
  equip: RIGHT, pwr: 3, agl: 3
})
defineItem(62, 'Dagger', 56, SELL | DISCARD, 'Standard stabbing equipment', {
  equip: RIGHT, pwr: 4, agl: 5
})
defineItem(63, 'Short Sword', 80, SELL | DISCARD, 'Swing it', {
  equip: RIGHT, pwr: 6, agl: 3
})
defineItem(64, 'Flint Spear', 120, SELL | DISCARD, 'Ancient tool, great for hunting', {
  equip: TWOHAND, pwr: 9, agl: 4
})
defineItem(65, 'Mace', 85, SELL | DISCARD, 'Seeing the damage makes you smarter', {
  equip: RIGHT, pwr: 7, agl: 3, wis: 1
})
defineItem(66, 'White Book', 90, SELL | DISCARD,
  'Full of tasty cooking recipes, but your opponent doesn\'t know that.',
  { equip: LEFT, agl: 2, wis: 5 }
)
defineItem(67, 'Small buckler', 78, SELL | DISCARD, 'Will deflect an arrow if held at an approriate angle', {
  equip: LEFT, agl: 2, wis: 0, def: 5
})
defineItem(68, 'Flute', 150, SELL | DISCARD, 'A charming piece of wood with decent mana conductivity', {
  equip: LEFT, agl: 5, wis: 2, def: 2
})
defineItem(80, 'Wool Cap', 25, SELL | DISCARD, 'Keep your head warm', {
  equip: HEAD, wis: 0, def: 1
})
defineItem(81, 'Pointy Hat', 80, SELL | DISCARD, 'A trend of the past', {
  equip: HEAD, wis: 3, def: 1
})
// -- gpt halps
// More items defined in the style provided
defineItem(82, 'Leather Boots', 50, SELL | DISCARD, 'Durable footwear for rugged terrains.', {
  equip: FEET, def: 2, agl: 1
})
defineItem(85, 'Torch', 5, SELL | DISCARD, 'Provides light in dark places. Lasts for one hour.')
defineItem(86, 'Rope', 10, SELL | DISCARD, 'A sturdy rope, useful for climbing or binding things together.')
defineItem(87, 'Iron Shield', 230, SELL | DISCARD, 'A solid piece of defense, quite heavy.', {
  equip: LEFT, def: 7, agl: -3
})
defineItem(88, 'Long Bow', 450, SELL | DISCARD, 'A long range bow that requires skill and strength to use effectively.', {
  equip: TWOHAND,
  pwr: 12,
  agl: 8,
  req: { lvl: 6, agl: 10 }
})
/* defineItem(89, 'Arrows', 1, STACK | SELL | DISCARD, // TODO: this is a good idea
  'Used with a bow to hit things from afar.',
  { count: 20 } // Number of arrows in a stack
) */
defineItem(91, 'Traveler\'s Cloak', 75, SELL | DISCARD, 'A rugged cloak designed for long journeys.', {
  equip: BODY, def: 3, agl: 1
})
defineItem(92, 'Bandit Mask', 85, SELL | DISCARD, 'Provides anonymity and a bit of flair.', {
  equip: HEAD, agl: 2
})
defineItem(93, 'Adventurer\'s Map', 200, STACK | SELL | DISCARD,
  'Shows the surrounding region with notable landmarks.',
  { type: 'key', unlocks: A.forest }
)
defineItem(94, 'Thieves\' Tools', 350, STACK | SELL | DISCARD, 'Contains lockpicks and other small tools essential for any aspiring thief.', {
  type: 'key', unlocks: A.sewers
})
defineItem(95, 'Grapple Hook', 700, STACK | SELL | DISCARD, 'Useful for scaling walls or securing paths.', {
  type: 'key', unlocks: A.mountain
})

defineItem(101, 'Broadsword', 500, SELL | DISCARD, 'A heavy blade that demands strength and endurance.', {
  equip: RIGHT, pwr: 10, agl: -2
})
defineItem(102, 'Falchion', 400, SELL | DISCARD, 'A curved sword optimized for slashing through opponents.', {
  equip: RIGHT, pwr: 8, agl: 3
})
defineItem(103, 'Whip', 250, SELL | DISCARD, 'Long range and flexibility, but requires elegance.', {
  equip: RIGHT, pwr: 5, agl: 4
})
defineItem(104, 'Warhammer', 600, SELL | DISCARD, 'Brutal in force; this hammer can crush any armor.', {
  equip: TWOHAND, pwr: 12, agl: 0
})
defineItem(105, 'Morning Star', 550, SELL | DISCARD, 'A spiked ball on a chain, effective against heavily armored foes.', {
  equip: RIGHT, pwr: 11, agl: -1
})
defineItem(106, 'Flail', 450, SELL | DISCARD, 'Difficult to master, deadly to face.', {
  equip: RIGHT, pwr: 9, agl: 1
})
defineItem(107, 'Rapier', 420, SELL | DISCARD, 'Favored by duelists for its agility and precision.', {
  equip: RIGHT, pwr: 7, agl: 3
})
defineItem(108, 'Quarterstaff', 200, SELL | DISCARD, 'A versatile and balanced weapon, good for defense and attack.', {
  equip: TWOHAND, pwr: 8, agl: 2
})
defineItem(109, 'Bronze Knuckles', 300, SELL | DISCARD, 'Enhances unarmed strikes significantly.', {
  equip: RIGHT, pwr: 6, agl: 4, pow: 6
})
defineItem(120, 'Leather Vest', 150, SELL | DISCARD, 'Offers basic protection without sacrificing mobility.', {
  equip: BODY, def: 4
})
defineItem(121, 'Hauberk', 350, SELL | DISCARD, 'A long coat of chainmail, offering solid defense.', {
  equip: BODY, def: 6, agl: -1
})
defineItem(122, 'Plate Mail', 800, SELL | DISCARD, 'Heavy and protective, best for the front-line warriors.', {
  equip: BODY, def: 12, agl: -3
})
defineItem(123, 'Ring Mail', 400, SELL | DISCARD, 'Rings linked together provide a balance between protection and flexibility.', {
  equip: BODY, def: 5, agl: -1
})
defineItem(130, 'Circlet of Harmony', 220, SELL | DISCARD, 'A delicate circlet that enhances musical and magical abilities.', {
  equip: HEAD, wis: 3, agl: 2, def: 1, mag: 2
})
defineItem(131, 'Cabalist Hood', 190, SELL | DISCARD, 'A lightweight hood that helps concentrate magical energies.', {
  equip: HEAD, wis: 4, def: 2, mag: 1
})
defineItem(132, 'Headband', 160, SELL | DISCARD, 'A simple headband that aids in maintaining focus and balance.', {
  equip: HEAD, agl: 2, wis: 1, def: 1
})
defineItem(140, 'Silk Robe', 310, SELL | DISCARD, 'A beautifully crafted robe that does not hinder movement.', {
  equip: BODY, agl: 3, def: 3
})
defineItem(141, 'Intricate Mantle', 340, SELL | DISCARD, 'Enchanted mantle that protects against physical and elemental harm.', {
  equip: BODY, def: 4, wis: 4
})
defineItem(142, 'Zen Gi', 800, SELL | DISCARD, 'A reinforced gi that allows for free movement while providing basic protection.', {
  equip: BODY, def: 12, agl: 8, wis: 3
})

/// --------------------------------------
/// AREAS
/// --------------------------------------

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
        I.torch,
        I.rope,
        I.smoke_bomb,
        I.adventurers_map,
        I.thieves_tools,
        I.grapple_hook,
        I.white_book
      ],
      buys: ['commodity', 'consumable']
    },
    {
      id: 1,
      name: 'Blacksmith',
      sells: [
        I.rusty_knife,
        I.dagger,
        I.small_buckler,
        I.short_sword,
        I.mace,
        I.iron_shield,
        I.bronze_knuckles,
        I.long_bow,
        I.quarterstaff,
        I.whip,
        I.ring_mail,
        I.travelers_cloak,
        I.leather_vest,
        I.wool_cap,
        I.headband,
        I.leather_boots
      ],
      buys: ['equipment']
      // TODO: custom buy/sell scaler
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
  encounters: [ // TODO: defineMonster
    {
      type: 'monster',
      name: 'Tiny Goblin',
      chance: 6,
      baseStats: [4, 3, 1],
      lvl: { min: 3, max: 7 },
      hp: 7,
      xp: 10,
      // option: barter
      loot: [
        { id: I.gold, chance: 2, qty: 15 },
        { id: I.rusty_knife, chance: 1, qty: 1 },
        { id: I.flint_spear, chance: 1, qty: 1 },
        { id: I.fish, chance: 2, qty: 1 }
      ],
      description: 'A tiny goblin is gingerly barbecuing a fish, you wonder where he caught it.'
    },
    {
      type: 'monster',
      name: 'Jello Spawn',
      chance: 7,
      baseStats: [2, 1, 4],
      lvl: { min: 1, max: 5 },
      hp: 10,
      xp: 15,
      // option: barter
      loot: [
        { id: I.gold, chance: 3, qty: 8 },
        { id: I.herb, chance: 1, qty: 2 },
        { id: I.fish, chance: 2, qty: 2 },
        { id: I.mace, chance: 1, qty: 1 }
      ],
      description: 'There used to be friendly slimes grazing the plains, but due to some xorcery one of them mutated and then ate all the rest.'
    },
    {
      type: 'monster',
      name: 'Jello Pup',
      chance: 6,
      baseStats: [2, 5, 3],
      lvl: { min: 2, max: 6 },
      hp: 10,
      xp: 15,
      // option: barter
      loot: [
        { id: I.gold, chance: 3, qty: 8 },
        { id: I.herb, chance: 1, qty: 2 },
        { id: I.fish, chance: 2, qty: 2 },
        { id: I.whip, chance: 1, qty: 1 }
      ],
      description: "Ok so, they used to be cute, then they grew teeth and now there's legs...\nMaybe now is a good time to see who's swifter?"
    },
    {
      type: 'monster',
      name: 'Wandering Merchant',
      chance: 5,
      baseStats: [5, 4, 6],
      lvl: { min: 5, max: 9 },
      hp: 15,
      xp: 18,
      loot: [
        { id: I.gold, chance: 4, qty: 18 },
        { id: I.sharp_stick, chance: 2, qty: 1 },
        { id: I.leather_boots, chance: 1, qty: 1 }
      ],
      description: 'With a sly smile he offers you a copper for your boots'
    },
    {
      type: 'monster',
      name: 'Lost Spirit',
      chance: 3,
      baseStats: [3, 5, 9],
      lvl: { min: 5, max: 8 },
      hp: 9,
      xp: 20,
      loot: [
        { id: I.gold, chance: 5, qty: 20 },
        { id: I.white_book, chance: 2, qty: 1 },
        { id: I.intricate_mantle, chance: 1, qty: 1 }
      ],
      description: 'The ghost of a woman set upon some misery still wanders the plains in search for closure'
    },
    {
      type: 'monster',
      name: 'Hippogryph',
      chance: 1,
      baseStats: [9, 8, 4],
      lvl: { min: 7, max: 16 },
      hp: 55,
      xp: 73,
      loot: [
        { id: I.gold, chance: 5, qty: 50 },
        { id: I.whip, chance: 1, qty: 1 },
        { id: I.flute, chance: 1, qty: 1 },
        { id: I.plate_mail, chance: 1, qty: 1 },
        { id: I.warhammer, chance: 1, qty: 1 },
        { id: I.red_potion, chance: 3, qty: 2 },
        { id: I.hypercore, chance: 9, qty: 1 }
        // { id: I.holy_replica, chance: Infinity, qty: 1 },
        // { id: I.hyper_modem56, chance: Infinity, qty: 5 }
      ],
      description: 'A majestic yet fearsome beast swoops down from the skies.\nIt looks like you\'ve again been mistaken for dinner..'
    },
    {
      type: 'monster',
      name: 'Highway Robber',
      chance: 3,
      baseStats: [4, 6, 4],
      lvl: { min: 6, max: 11 },
      hp: 18,
      xp: 28,
      loot: [
        { id: I.gold, chance: 5, qty: 31 },
        { id: I.bandit_mask, chance: 2, qty: 1 },
        { id: I.rapier, chance: 1, qty: 1 },
        { id: I.long_bow, chance: 1, qty: 1 },
        { id: I.ration, chance: 3, qty: 1 }
      ],
      description: 'You\'re ambushed by a bandit, he wiggles his eyebrows at you saying "Hand over your gear peacefully and i\'ll let you keep your pantaloons"'
    }
  ]
}

// TODO: function valdiate(): no-unlinked-items, no-unlinked-areas, no-unlinked-dungeons, no-unlinked-encounters
