import Core from './lib/core.js'
export * as DB from './db.js'
// export * as Core from './lib/core.js'
export default Core

export async function boot (storage, Hyperswarm, cb = null) {
  if (!Hyperswarm) Hyperswarm = await import('hyperswarm')
  const core = new Core(storage)
  await core.boot()

  if (Hyperswarm) await core.beginSwarm(Hyperswarm)

  if (typeof cb === 'function') cb(core)

  return core
}
