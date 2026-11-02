// Shared contract between DidController.handleWeb() (writer) and
// WellKnownController (reader) for "which did:web should this agent serve
// at /.well-known/did.json". The platform tracks primary-DID status in its
// own Postgres `org_dids` table, but this agent process has no access to
// that database - this genericRecord is this agent's own local copy,
// using the same mechanism this codebase already uses elsewhere for
// agent-level singleton state (e.g. the JWT secret key in cliAgent.ts).
const PRIMARY_DID_WEB_TAG = 'primaryDidWeb'

// Mirrors @credo-ts/core's TagsBase shape exactly (string values, numeric
// keys disallowed) so real GenericRecordsApi methods satisfy this interface
// without a direct runtime import - @credo-ts/core is real ESM and can't be
// loaded under ts-jest (see WellKnownController.test.ts), so this stays a
// type-only, import-free structural copy rather than `import type` from it.
type TagValue = string | boolean | undefined | string[] | null
interface TagsBase {
  [key: string]: TagValue
  [key: number]: never
}

interface PrimaryDidWebRecord {
  content: Record<string, unknown>
  setTag(name: string, value: TagValue): void
}

interface GenericRecordsLike {
  findAllByQuery(query: TagsBase): Promise<PrimaryDidWebRecord[]>
  save(options: { content: Record<string, unknown>; tags: TagsBase }): Promise<unknown>
  update(record: PrimaryDidWebRecord): Promise<void>
}

/** Marks `did` as this agent's primary did:web, replacing any previous pointer. */
export async function setPrimaryDidWeb(agent: { genericRecords: GenericRecordsLike }, did: string): Promise<void> {
  const [existingRecord] = await agent.genericRecords.findAllByQuery({ [PRIMARY_DID_WEB_TAG]: 'true' })

  if (existingRecord) {
    existingRecord.content.did = did
    existingRecord.setTag(PRIMARY_DID_WEB_TAG, 'true')
    await agent.genericRecords.update(existingRecord)
  } else {
    await agent.genericRecords.save({
      content: { did },
      tags: { [PRIMARY_DID_WEB_TAG]: 'true' },
    })
  }
}

/** Returns the did:web marked primary for this agent, if any pointer exists. */
export async function getPrimaryDidWeb(agent: {
  genericRecords: Pick<GenericRecordsLike, 'findAllByQuery'>
}): Promise<string | undefined> {
  const [pointer] = await agent.genericRecords.findAllByQuery({ [PRIMARY_DID_WEB_TAG]: 'true' })
  return pointer?.content.did as string | undefined
}
