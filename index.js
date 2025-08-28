import Core from './lib/core.js'
export * as DB from './db.js'
// export * as Core from './lib/core.js'
export default Core

export async function boot (storage, cb = null) {
  const core = new Core(storage)
  await core.boot()

  if (typeof cb === 'function') cb(core)

  return core
}
