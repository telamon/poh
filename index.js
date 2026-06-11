import Core, { deriveWorldTopic } from './lib/core.js'
export * as DB from './db.js'
// export * as Core from './lib/core.js'
export default Core
export { deriveWorldTopic }

export async function boot (storage, opts = {}, cb = null) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  if (opts.worldKey) {
    opts = { ...opts, worldTopic: await deriveWorldTopic(opts.worldKey) }
  }

  const core = new Core(storage, opts)
  await core.boot()

  if (typeof cb === 'function') cb(core)

  return core
}
