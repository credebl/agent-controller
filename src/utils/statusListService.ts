import type { Agent, JwsProtectedHeaderOptions, VerificationMethod } from '@credo-ts/core'

import { JwsService, JwtPayload } from '@credo-ts/core'
import { StatusList, getListFromStatusListJWT } from '@sd-jwt/jwt-status-list'

import { STATUS_LISTS_PATH } from './constant'
import { getAlgFromVerificationMethod, getVerificationMethod, fetchWithTimeout } from './helpers'

const statusListLocks = new Map<string, Promise<void>>()

export function getServerUrl() {
  const url = process.env.STATUS_LIST_SERVER_URL
  if (!url) {
    throw new Error('STATUS_LIST_SERVER_URL is not configured')
  }
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function getApiKeyHeaders() {
  const key = process.env.STATUS_LIST_API_KEY
  if (!key) {
    throw new Error('STATUS_LIST_API_KEY is not configured')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  headers['x-api-key'] = key
  return headers
}

async function getKmsKeyIdForDid(agent: Agent, did: string, verificationMethodId: string) {
  const didRecords = await agent.dids.getCreatedDids({ did })
  const didRecord = didRecords[0]
  if (didRecord && didRecord.keys) {
    const relativeId = verificationMethodId.includes('#') ? verificationMethodId.split('#')[1] : verificationMethodId
    const keyMap = didRecord.keys.find(
      (k: any) => k.didDocumentRelativeKeyId === `#${relativeId}` || k.didDocumentRelativeKeyId === relativeId,
    )
    if (keyMap) {
      return keyMap.kmsKeyId
    }
  }
  return verificationMethodId
}

async function signStatusList(
  agent: Agent,
  verificationMethod: VerificationMethod,
  statusList: StatusList,
  listId: string,
  issuerDid: string,
): Promise<string> {
  const payload = new JwtPayload({
    iss: issuerDid,
    sub: `${getServerUrl()}/${STATUS_LISTS_PATH}/${listId}`,
    iat: Math.floor(Date.now() / 1000),
    additionalClaims: {
      status_list: {
        bits: statusList.getBitsPerStatus(),
        lst: statusList.compressStatusList(),
      },
    },
  })

  const alg = getAlgFromVerificationMethod(verificationMethod)
  const jwsService = agent.dependencyManager.resolve(JwsService)
  const kmsKeyId = await getKmsKeyIdForDid(agent, issuerDid, verificationMethod.id)

  const header: JwsProtectedHeaderOptions = {
    alg: alg as any,
    typ: 'statuslist+jwt',
    kid: verificationMethod.id,
  }

  return jwsService.createJwsCompact(agent.context, {
    keyId: kmsKeyId,
    payload,
    protectedHeaderOptions: header,
  })
}

export async function checkAndCreateStatusList(agent: Agent, listId: string, issuerDid: string, listSize?: number) {
  const previousLock = statusListLocks.get(listId) || Promise.resolve()

  let releaseLock: () => void
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })

  statusListLocks.set(listId, currentLock)

  try {
    await previousLock

    const uri = `${getServerUrl()}/${STATUS_LISTS_PATH}/${listId}`

    const res = await fetchWithTimeout(uri, {
      headers: getApiKeyHeaders(),
    })

    if (res.status === 404) {
      const size = listSize || Number(process.env.STATUS_LIST_DEFAULT_SIZE)
      if (!size || !Number.isInteger(size) || size <= 0) {
        throw new Error(
          `[checkAndCreateStatusList] invalid status list size: ${size}. Set STATUS_LIST_DEFAULT_SIZE to a positive integer.`,
        )
      }
      const statusList = new StatusList(new Array(size).fill(0), 1)

      const didDocument = await agent.dids.resolve(issuerDid)
      const verificationMethod = didDocument.didDocument ? getVerificationMethod(didDocument.didDocument) : undefined

      if (!verificationMethod) {
        throw new Error(`Could not find suitable verification method (assertionMethod) for DID ${issuerDid}`)
      }

      const jwt = await signStatusList(agent, verificationMethod, statusList, listId, issuerDid)
      const postRes = await fetchWithTimeout(`${getServerUrl()}/${STATUS_LISTS_PATH}`, {
        method: 'POST',
        headers: getApiKeyHeaders(),
        body: JSON.stringify({ id: listId, jwt }),
      })

      if (!postRes.ok && postRes.status !== 409) {
        const errBody = await postRes.text()
        throw new Error(`Failed to create list on server: ${postRes.status} ${errBody}`)
      }
    } else if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Failed to check status list ${listId} at ${uri}: ${res.status} ${res.statusText} ${errBody}`)
    }
  } catch (error) {
    throw error
  } finally {
    releaseLock!()
    if (statusListLocks.get(listId) === currentLock) {
      statusListLocks.delete(listId)
    }
  }
}

export async function revokeCredentialInStatusList(agent: Agent, listId: string, index: number, issuerDid: string) {
  const previousLock = statusListLocks.get(listId) || Promise.resolve()

  let releaseLock: () => void
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })

  statusListLocks.set(listId, currentLock)

  try {
    await previousLock

    const uri = `${getServerUrl()}/${STATUS_LISTS_PATH}/${listId}`

    const res = await fetchWithTimeout(uri, {
      headers: getApiKeyHeaders(),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Failed to fetch status list to revoke at ${uri}: ${res.status} ${res.statusText} ${errBody}`)
    }

    const currentJwt = await res.text()
    const statusList = getListFromStatusListJWT(currentJwt)

    statusList.setStatus(index, 1)

    const didDocument = await agent.dids.resolve(issuerDid)
    const verificationMethod = didDocument.didDocument ? getVerificationMethod(didDocument.didDocument) : undefined
    if (!verificationMethod)
      throw new Error(`Could not find suitable verification method (assertionMethod) for DID ${issuerDid}`)

    const newJwt = await signStatusList(agent, verificationMethod, statusList, listId, issuerDid)

    const patchRes = await fetchWithTimeout(`${getServerUrl()}/${STATUS_LISTS_PATH}/${listId}`, {
      method: 'PATCH',
      headers: getApiKeyHeaders(),
      body: JSON.stringify({ jwt: newJwt }),
    })

    if (!patchRes.ok) {
      const errBody = await patchRes.text()
      throw new Error(`Failed to update status list on server: ${patchRes.status} ${errBody}`)
    }
  } finally {
    releaseLock!()
    if (statusListLocks.get(listId) === currentLock) {
      statusListLocks.delete(listId)
    }
  }
}
