# Autobee Reiteration TODO

Goal: port the Proof-of-Honor persistence/contract layer to Autobee while preserving the original adventure-day machinery and making world identity explicit.

## Core Contract

- World creator controls the world rules.
- A pre-shared `world_key` identifies a world. The current default is `hash('poh:v1/kryptonia')`.
- `hash(world_key)` is also the replication topic.
- A writer's own `writer.key` is the basic hero/DNA identity.
- For the initial open world, any writer that commits a valid spawn event is admitted as a writer.
- Future PoH versions should require an invitation key/value before accepting spawn/admission, to prevent spam registrations.
- Adventure-day commits stay oplog based: begin from deterministic state, record actions, commit the transcript, replay and validate in apply, then materialize the resulting hero state.

## Autobee Shape

- Use one Autobee per world.
- Treat Autobee events as authoritative history.
- Treat the materialized bee view as derived state.
- Derive author identity from the append/writer context, not from payload fields.
- Use Autobee/system metadata for world freshness/versioning where possible; avoid payload `Date.now()` as authority.
- Keep the current tree-hash/previous-signature seed idea if it still matches the Autobee writer model.

## Required Event Types

- `world/genesis`: creates the world, ruleset identity, and admission policy.
- `player/spawn`: creates a hero for the committing writer and, in open admission mode, admits that writer.
- `pve/commit`: commits one validated daily PvE transcript.
- `world/invite`: future admission record for gated worlds.
- `world/revoke`: future moderation/admin control, if the world rules allow it.

## Validation Invariants

- Spawn payload must not be able to create or overwrite a hero for another writer.
- A writer can only advance its own hero unless the world rules explicitly allow delegation.
- Adventure replay must be deterministic from committed prior state plus transcript.
- The committed result must be derived by replay, not trusted from the client payload.
- Ruleset changes must be explicit world events, not silent code drift.

## Open Questions

- Is `writer.key` still the correct DNA input on main?
- Should `world_key` stay pre-shared forever, or become a bootstrap secret that derives public world identity plus private invitation material?
- Which Autobee timestamp/version scalar should gate daily adventure refresh?
- Do we need a separate leaderboard/index bee, or is it just another derived view over the world bee?
- What is the first minimal migration target: spawn only, or spawn plus one complete adventure-day commit?
