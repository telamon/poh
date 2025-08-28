import test from 'brittle'
import tmp from 'test-tmp'
import Corestore from 'corestore'
import Autobase from 'autobase'
import { encode as pack, decode as unpack } from 'cborg'
import { toHex } from '../lib/util.js'
import { replicateAndSync } from 'autobase-test-helpers'
/** @typedef {import('hypercore')} Hypercore */

test('hypercore exports a parent signature', async t => {
  const store = new Corestore(await tmp(t))

  const core = store.get({ name: 'writer' })

  await core.ready()
  t.is(core.length, 0, 'zero blocks')

  const genesis = await core.treeHash()
  t.alike(await core.treeHash(), genesis, 'is not random')

  await core.append(Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]))

  const b0 = await core.treeHash()
  t.ok(!b0.equals(genesis), 'updated')

  t.alike(await core.treeHash(0), genesis, 'is permanent')
  t.alike(await core.treeHash(1), b0, 'is adressable')
})

/** @typedef {import('autobase/lib/apply-calls.js').PrivateApplyCalls} PrivateApplyCalls */

test('autobase does not randomly append blocks', async t => {
  const store = new Corestore(await tmp(t))
  const view = { x: 0 }

  const base = new Autobase(store, null, {
    open (autoStore) {
      t.is(autoStore.store, store, 'same store')
      return view
    },
    apply
  })

  await base.ready()

  t.is(toHex(base.key), toHex(base.local.key), 'local writer identifies base')

  const genesis = await base.local.treeHash()

  /** @param {PrivateApplyCalls} b */
  function apply (nodes, v, b) {
    t.is(b.base.local, base.local, 'same base')
    t.is(v, view, 'same view')
    const [n] = nodes
    t.is(toHex(n.from.key), toHex(base.local.key), 'from is local')

    const x = n.value[0]

    if (v.x >= x) throw new Error('validation error')
    v.x = x
  }

  t.is(base.local.length, 0, 'local empty')
  t.is(base.length, 0, 'base empty')

  await base.append(Buffer.from([0x1]))
  t.is(base.local.length, 1, 'local length')
  t.is(view.x, 1, 'view was updated')

  const blocks = []
  for (let i = 0; i < base.length; i++) {
    blocks.push(await base.core.get(i))
  }

  t.is(base.length, 3, 'base length is a local bee')

  const b0 = await base.local.treeHash()
  t.ok(!b0.equals(genesis), 'updated')

  if (false) { // eslint-disable-line no-constant-condition
    await new Promise(resolve => setTimeout(resolve, 14000))

    t.is(
      toHex(b0),
      toHex(await base.local.treeHash()),
      'tree hash did not change'
    )
  }
})

function daisyChain (bases) {
  const streams = []
  let p
  for (const b of bases) {
    if (p) {
      const s0 = b.replicate(true)
      streams.push(s0)
      const s1 = p.replicate(false)
      streams.push(s1)

      s0.pipe(s1).pipe(s0)
    }
    p = b
  }

  return function destroy () {
    for (const s of streams) s.destroy()
  }
}

let _bootstrap = Buffer.alloc(32).fill(0xaa)
async function autobot (t, name, prefix) {
  const store = new Corestore(prefix + '/' + name)
  const view = { }

  const base = new Autobase(store, _bootstrap, {
    optimistic: true,

    open (autoStore) {
      return view
    },

    /** @param {PrivateApplyCalls} host */
    async apply (nodes, v, host) {
      for (const node of nodes) {
        /** @type {Hypercore} */
        const from = node.from
        const { name: n, x, key } = unpack(node.value)

        const fstr = toHex(from.key.subarray(0, 6))
        const kstr = key && toHex(key.subarray(0, 6))

        if (node.optimistic) {
          await host.ackWriter(from.key) // ad-hoc addWriter
        }

        if (key) {
          console.log(`[${name}] adding ${kstr} from ${fstr}`)
          await host.addWriter(key)
        } else {
          console.log(n !== name, `\t[${name}] apply ${n} <= ${x} @len=${from.length}`)

          v[n] ||= 0

          if (v[n] >= x) throw new Error('validation error')
          v[n] = x
        }
      }
    }
  })

  let i = 0

  async function step (optimistic = true) {
    await base.append(pack({ name, x: ++i }), { optimistic })
    await base.update()
  }

  /** This is boring */
  async function addWriter (key) {
    await base.append(pack({ key }))
  }

  if (true) { // eslint-disable-line no-constant-condition
    for (const ev of [
      'is-indexer',
      'is-non-indexer',
      'is-writable',
      'is-unwritable',
      'warning',
      'error'
      // 'update'
    ]) {
      base.on(ev, t.comment.bind(t, `<${name}>`, ev, base.length))
    }
  }

  await base.ready()

  _bootstrap ||= base.local.key

  return { base, step, view, name, addWriter }
}

test.solo('multibase', async t => {
  const prefix = await tmp(t, { name: 'optimistic', force: true })
  const names = ['a', 'b', 'c']
  const bots = []

  for (let i = 0; i < names.length; i++) {
    bots.push(await autobot(t, names[i], prefix))
  }

  const [a] = bots
  const bases = bots.map(b => b.base)
  await a.step()

  await replicateAndSync(bases)

  t.pass('empty sync')

  const destroy = daisyChain(bases)

  for (let i = 0; i < 3; i++) {
    for (const { step } of bots) {
      await step(true)
      // await replicateAndSync(bases)
    }
  }

  t.ok('rep & sync returned')
  await new Promise(resolve => setTimeout(resolve, 1000))
  destroy()

  for (const { view, name } of bots) {
    t.comment('view', name, view)
  }

  for (const { base, name } of bots) {
    t.comment('len', name, base.length, base.local.length)
  }
  /*
  for (let i = 0; i < a.base.local.length; i++) {
    const tx = await a.base.local.get(i)
    const v = unpack(tx.node.value)
    console.log(tx, v)
  } */
})
