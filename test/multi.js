import test from 'brittle'
import Corestore from 'corestore'
import tmp from 'test-tmp'
import Core from '../index.js'
import { cmp, toU8, typeOf } from '../lib/util.js'

async function boot (t, opts = {}) {
  const dir = await tmp(t)
  const core = new Core(new Corestore(dir), opts)
  await core.boot()
  t.teardown(() => core.base.close())
  return core
}

function replicate (...cores) {
  const streams = []

  while (cores.length > 1) {
    const a = cores.pop()

    for (const b of cores) {
      const s1 = a.store.replicate(true)
      const s2 = b.store.replicate(false)

      s1.pipe(s2).pipe(s1)

      streams.push(s1, s2)
    }
  }

  return async function close () {
    for (const stream of streams) stream.destroy()
  }
}

async function sync (...cores) {
  const deadline = Date.now() + 2000

  while (Date.now() < deadline) {
    if (await synced(cores)) {
      for (const core of cores) await core.base.flush()
      if (await synced(cores)) return
    }

    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error('cores did not sync')
}

async function synced (cores) {
  for (const core of cores) {
    await core.base.updated()

    for (const other of cores) {
      if (core === other) continue

      await other.base.updated()

      const info = await other.base.system.get(core.base.local.key)
      const length = info ? info.length : 0

      if (length !== core.base.local.length) return false
    }
  }

  return true
}

async function replicateAndSync (...cores) {
  const close = replicate(...cores)
  await sync(...cores)
  await close()
}

test('creator world key bootstraps joining peer', async t => {
  const creator = await boot(t)
  const createdWorld = await creator.createWorld()
  await creator.createHero('creator', 'root')

  const worldKey = creator.base.key
  const peer = await boot(t, {
    bootstrap: worldKey,
    worldTopic: creator.worldTopic
  })

  t.alike(peer.base.key, worldKey, 'peer joins creator autobee')
  t.alike(peer.worldTopic, creator.worldTopic, 'peers share discovery topic')

  await replicateAndSync(creator, peer)

  t.alike(await peer.readWorld(), createdWorld, 'peer sees creator world metadata')
  t.ok(await peer.readPlayer(creator.pk), 'peer sees creator hero')
})

test('optimistic spawn admits joining writer', async t => {
  const creator = await boot(t)
  await creator.createHero('creator', 'root')

  const peer = await boot(t, {
    bootstrap: creator.base.key,
    worldTopic: creator.worldTopic
  })

  await replicateAndSync(creator, peer)

  const spawned = peer.createHero('peer', 'optimistic')
  await spawned

  const close = replicate(creator, peer)

  await creator.addRemote(peer.pk)
  await sync(creator, peer)
  await close()

  t.ok(await creator.readPlayer(peer.pk), 'creator sees admitted peer hero')
  t.ok(await peer.readPlayer(peer.pk), 'peer sees own hero')
  t.ok(peer.base.writable, 'peer became writable')

  await peer.beginPVE()
  await peer.commitPVE()
  await replicateAndSync(creator, peer)

  const creatorView = await creator.readPlayer(peer.pk)
  const peerView = await peer.readPlayer(peer.pk)

  t.is(creatorView.adventures, 1, 'creator sees peer adventure')
  t.is(peerView.adventures, 1, 'peer sees own adventure')
  t.absent(compare(creatorView, peerView, true), 'peer hero is identical on creator and peer')
})

function compare (a, b, onlyDiff = false, depth = 0) {
  function eql (a, b) {
    if (typeOf(a) === 'u8') return cmp(toU8(a), toU8(b))
    return a === b
  }
  function inspect (o) {
    if (typeOf(o) === 'u8') return Buffer.from(toU8(o)).toString('hex')
    return JSON.stringify(o)
  }
  const indent = n => Array.from(new Array(n)).map(() => '  ').join('')
  if (typeOf(a) !== typeOf(b)) return `${inspect(a)} != ${inspect(b)}\n`

  if (typeOf(a) === 'array' || typeOf(a) === 'object') {
    let out = ''
    const keys = []
    for (const k in a) if (keys.indexOf(k) === -1) keys.push(k)
    for (const k in b) if (keys.indexOf(k) === -1) keys.push(k)
    for (const k of keys) {
      const diff = compare(a[k], b[k], onlyDiff, depth + 1)
      if (diff) out += indent(depth + 1) + `${k}: ` + diff
    }
    return out.length
      ? (Array.isArray(a) ? '[\n' : '{\n') + out + indent(depth) + (Array.isArray(a) ? ']\n' : '}\n')
      : null
  }

  if (!onlyDiff && eql(a, b)) return `${inspect(a)} == ${inspect(b)}\n`
  else if (!eql(a, b)) return `${inspect(a)} != ${inspect(b)}\n`
}
