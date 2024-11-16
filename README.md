# poh.core

This is the kernel for the P2PMMO game: _Proof of Honor_.

The core is transaction-based and headless meaning
that you can send your action-blocks to a buddy and
a perfect copy of your character appears in their world.

- it's written ontop of [pico](https://github.com/telamon/pico-stack)
- can use [hyperswarm](https://github.com/holepunchto/hyperswarm) for multiplay
- is totally missing an UI - _Please PR/or Issue if you build one!_

[![asciicast](https://asciinema.org/a/4t8Zy3CScVMR56qmvrVNz2F46.svg)](https://asciinema.org/a/4t8Zy3CScVMR56qmvrVNz2F46)

## Objectives / How to play

> Once every 24 hours a `Hero` may\
> append 1 block of actions - each block\
> must end with either going to sleep at a tavern or death.

#### boot
Initialize kernel and create a new character:
```js
import { boot } from 'poh'

const kernel = await boot()

const name = 'Duncan the peerless'
const memo = '<Last words on death>'

await kernel.createHero(name, memo)


// character sheet is exposed as a reactive-store

const unsub = kernel.$player(hero => {
    console.log('current stats and inventory', hero)
})
unsub()
```

#### begin
Now that you have a kernel and a hero,
you can begin exploring,\
maybe visit the town for some shopping:

```js
import {
I, // Items
A  // Areas
} from 'poh/db'

const session = await kernel.beginPVE()

// walk to town
await session.travelTo(A.crossroads)
await session.travelTo(A.town)

// Buy a dagger
await session.interact(0, 'buy', I.dagger, 1)

// Check inventory
kernel.$player(h => console.log('Inventory', h.inventory))()

// Equip the weapon
await session.use(I.dagger)
```

Good, now we're ready for adventure!

```js
// walk back to crossroads
await session.travelTo(A.crossroads)

// look for trouble
const encounter = await session.explore(0)
console.log('You encountered', encounter)
```

#### battle

If a the encounter is hostile, you'll be locked in `session.state == 'battle'`\ 
at which point you are forced to choose one of the following:

```js
// Hit the critter
result = session.doBattle('attack')

// Use a skill/spell
result = session.doBattle('cast', 'firebolt')

// Attempt escape
result = session.doBattle('run')
```

Note: Each round you're allowed to use 1 item `session.use(I.herb)`
_before_ you commit your combat action via `session.doBattle()`

#### sleep

Once you're happy with your achievements it's time to save state
and call it a day:
```js
// goto area with tavern/bed
await session.travelTo(A.town)

// sleep

const [diff] = await kernel.commitPVE()

console.log('gold, xp and stats gained', diff)
```

note: `k.commitPVE()` broadcasts your character to the network\
if kernel was booted with swarm `K = await boot(Hyperswarm)`

Ok that's pretty much the gist of it; \
But always keep an eye on:
```js
kernel.$player(hero =>
  console.log('current exhaustion', hero.exhaustion)
)()
```
because:

> [!IMPORTANT]
> All actions that require [random/rolls]() increase `exhaustion`
> ```js
> exhaustion > 1024 = DEATH
> ```

#### reference

Checkout [`test.js:89` _'Express gameplay as functions'_](./test.js#L89) for a complete
implementation of gameplay.

Checkout [`testnet.js`](./testnet.js) for multiplayer/w bots.

Prior attempt / version 0: [PoH-2020](https://git.sr.ht/~telamohn/poh)

## LICENSE

`AGPL-version-3`

Clarification:

- do whatever you wish with your UI / assets
- please PR patches and changes to gameplay, so everyone can play the same game.
- _no sublicensing_ (even if you're a cool dude). the license is the license.

All wrongs reversed 🄯 2024 Tony Ivanov - decentlabs

