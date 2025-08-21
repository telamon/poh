import Hyperswarm from 'hyperswarm'
import Autobase from 'autobase'
import HyperDB from 'hyperdb'
import { Router, encode } from '../spec/hyperdispatch/index.js'
import db from '../spec/db/index.js'
import N from 'piconuro'
const { init, mute } = N

export default class FatKernel {
  #opts
  router = new Router()

  constructor (store, opts = {}) {
    this.store = store
    this.bootstrap = opts.bootstrap || null
    this.#opts = opts

    this.router.add('@honor/spawn-player', async (data, context) => {
      console.log(data, context)
      await context.base.spawnPlayer(data)
    })
  }

  async boot () {
    const { key } = this.#opts

    this.base = new Autobase(this.store, key, {
      open: store => HyperDB.bee(store.get('view'), db, {
        extension: false,
        autoUpdate: true
      }),
      apply: this._apply.bind(this)
    })

    // fugly
    this.base.on('update', () => {
      if (!this.base._interrupting) this.emit('update')
    })
  }

  async _apply (nodes, view, base) {
    console.log('apply', nodes, view, base)
    for (const node of nodes) {
      await this.router.dispatch(node.value, { view, base })
    }

    await view.flush()
  }

  async createHero (name, memo) {
    await this.base.append(encode('@honor/spawn-player', { key: 'n/a', name, memo }))
  }

  get $player () {
    return init(undefined)
    /*
    const $blockState = mute(
      s => this.store.on(MEM_HERO, s),
      players => {
        if (!this.#selectedChain) return
        const player = players[toHex(this.#selectedChain)]
        if (!player) return // Create one first
        return upgradePlayer(this.pk, player)
      }
    )
    const c = combine($blockState, this._pve_hero[0])
    return mute(c, ([block, pve]) => pve || block) // prefer virtual PvE-state, remember to clean on commit
    */
  }

  // godot cannot handle '$' method names nor iterate JS-Arrays
  get on_player () { // but neuro is flexible
    return mute(this.$player, value => JSON.stringify(value))
  }
}
