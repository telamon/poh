import Hyperswarm from 'hyperswarm'
import Autobase from 'autobase'
import HyperDB from 'hyperdb'
import { Router, encode } from '../spec/hyperdispatch/index.js'
import db from '../spec/db/index.js'

export default class FatKernel {
  #opts
  router = new Router()

  constructor (store, opts = {}) {
    this.store = store
    this.bootstrap = opts.bootstrap || null
    this.#opts = opts

    this.router.add('@honor/spawn', async (data, context) => {
      console.log(data, context)
      await context.base.spawnPlayer(data)
    })
  }

  async boot () {
    const { key } = opts

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

  async spawnPlayer (data) {
    console.log('spawn player', data, this)
    await this.base.append(encode('@honor/player', { body: new Uint8Array(15) }))
  }
}
