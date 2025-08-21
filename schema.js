import Hyperschema from 'hyperschema'
import HyperdbBuilder from 'hyperdb/builder'
import Hyperdispatch from 'hyperdispatch'

const NAMESPACE = 'honor'

// Data Structs
const poh = Hyperschema.from('./spec/schema')
const template = poh.namespace(NAMESPACE)

template.register({
  name: 'player',
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'memo', type: 'string', required: false }
  ]
})

Hyperschema.toDisk(poh)

// Database Collections
const dbTemplate = HyperdbBuilder.from('./spec/schema', './spec/db')
const blobs = dbTemplate.namespace(NAMESPACE)

blobs.collections.register({
  name: 'players',
  schema: '@honor/player',
  key: ['key']
})

HyperdbBuilder.toDisk(dbTemplate)

// Actions

const hyperdispatch = Hyperdispatch.from('./spec/schema', './spec/hyperdispatch')
const namespace = hyperdispatch.namespace(NAMESPACE)

namespace.register({ name: 'spawn-player', requestType: '@honor/player' })
namespace.register({ name: 'pve-session', requestType: '@honor/player' })

Hyperdispatch.toDisk(hyperdispatch)
