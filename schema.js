import Hyperschema from 'hyperschema'
import HyperdbBuilder from 'hyperdb/builder'
import Hyperdispatch from 'hyperdispatch'

const NAMESPACE = 'honor'

// Data-structs
const poh = Hyperschema.from('./spec/schema')
const template = poh.namespace(NAMESPACE)

template.register({ // database + block
  name: 'player',
  fields: [
    { name: 'key', type: 'buffer', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'memo', type: 'string', required: false },
    { name: 'spawned', type: 'uint', required: true },
    { name: 'seen', type: 'uint', required: true },
    { name: 'adventures', type: 'uint', required: true }, // n-sessions completed
    { name: 'state', type: 'string', required: true },
    { name: 'location', type: 'int', required: true },
    { name: 'kills', type: 'uint', required: true },
    { name: 'escapes', type: 'uint', required: true },
    { name: 'deaths', type: 'uint', required: true }, // life - deaths < 0 == perma death
    { name: 'hp', type: 'int', required: true },
    { name: 'experience', type: 'uint', required: true }, // Total Experience

    { name: 'career', type: 'string', array: true, required: true },

    { name: 'inventory', type: `@${NAMESPACE}/item`, array: true, required: true }
  ]
})

template.register({
  name: 'item',
  fields: [
    // Item
    { name: 'id', type: 'uint', required: true },
    { name: 'qty', type: 'uint', required: true },
    // UniqueItem
    { name: 'uid', type: 'string', required: false },
    { name: 'equipped', type: 'bool', required: false },
    { name: 'stats', type: `@${NAMESPACE}/item_stats`, required: false }
  ]
})

template.register({
  name: 'item_stats',
  fields: [
    { name: 'pwr', type: 'int', required: true },
    { name: 'agl', type: 'int', required: true },
    { name: 'wis', type: 'int', required: true },
    { name: 'atk', type: 'int', required: true },
    { name: 'def', type: 'int', required: true },
    { name: 'mag', type: 'int', required: true }
  ]
})

template.register({ // block only
  name: 'pve-session',
  fields: [
    { name: 'date', type: 'uint', required: true },
    // { name: 'actions', type: `@${NAMESPACE}/pve-action`, array: true, required: true }
    { name: 'actions', type: 'buffer', required: true } // TODO: torch hyperschema
  ]
})

/*
template.register({ // block only
  name: 'pve-action',
  fields: [
    { name: 'type', type: 'string', required: true },
    // action specific keys;

    // action: path
    { name: 'job', type: 'string', required: false },

    // action: travel
    { name: 'areaId', type: 'int', required: false },
    { name: 'from', type: 'int', required: false },

    // action: explore
    { name: 'dungeonId', type: 'int', required: false },

    // action: battle
    { name: 'action', type: 'string', required: false },
    { name: 'arg', type: 'string', required: false },

    // action: use
    { name: 'item', type: 'string', required: false }
  ]
})
*/

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
namespace.register({ name: 'pve-session', requestType: '@honor/pve-session' })

Hyperdispatch.toDisk(hyperdispatch)
