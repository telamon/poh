export const ITEMS = {}
// FLAGS
const [STACK, SELL, DISCARD, USE] = [0b1, 0b10, 0b100, 0b1000, 0b10000]
const [NONE, LEFT, RIGHT, HEAD, BODY, FEET] = [0, 1, 2, 3, 4, 5]
/**
 * @param {number} id
 * @param {string} name
 * @param {number} vendorPrice
 * @param {number} caps
 * @param {string} description
 * @param {any} opts
 */
function defineItem(id, name, vendorPrice, caps, description, opts = {}) {
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
  ITEMS[id] = item
}

defineItem(1, 'Gold', 1, STACK, 'The stuff that gleams')
defineItem(30, 'Herb', 100, STACK|SELL|DISCARD|USE, 'A natural anti-septic')
defineItem(60, 'Sharp Stick', 0, STACK|SELL|DISCARD, 'You touched the pointy end and discovered that it\'s quite sharp.', { equip: RIGHT })


