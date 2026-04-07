import { Agent, JwsProtectedHeaderOptions, JwsService, JwtPayload } from '@credo-ts/core';
import { StatusList, getListFromStatusListJWT } from '@sd-jwt/jwt-status-list';
import { STATUS_LISTS_PATH } from './constant';

const statusListLocks = new Map<string, Promise<void>>();


export function getServerUrl() {
    const url = process.env.STATUS_LIST_SERVER_URL;
    if (!url) {
        throw new Error('STATUS_LIST_SERVER_URL is not configured');
    }
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getApiKeyHeaders() {
    const key = process.env.STATUS_LIST_API_KEY;
    if (!key) {
        throw new Error('STATUS_LIST_API_KEY is not configured');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    headers['x-api-key'] = key;
    return headers;
}

async function getKmsKeyIdForDid(agent: Agent, did: string, verificationMethodId: string) {
    const didRecords = await agent.dids.getCreatedDids({ did });
    const didRecord = didRecords[0];
    if (didRecord && didRecord.keys) {
        const relativeId = verificationMethodId.includes('#') ? verificationMethodId.split('#')[1] : verificationMethodId;
        const keyMap = didRecord.keys.find((k: any) => k.didDocumentRelativeKeyId === `#${relativeId}` || k.didDocumentRelativeKeyId === relativeId);
        if (keyMap) {
            return keyMap.kmsKeyId;
        }
    }
    return verificationMethodId;
}

async function signStatusList(agent: Agent, verificationMethodId: string, statusList: StatusList, listId: string, issuerDid: string): Promise<string> {
    const payload = new JwtPayload({
        iss: issuerDid,
        sub: `${getServerUrl()}/${STATUS_LISTS_PATH}/${listId}`,
        iat: Math.floor(Date.now() / 1000),
        additionalClaims: {
            status_list: {
                bits: statusList.getBitsPerStatus(),
                lst: statusList.compressStatusList(),
            }
        }
    });

    const header: JwsProtectedHeaderOptions = {
        alg: 'EdDSA',
        typ: 'statuslist+jwt',
    };

    const jwsService = agent.dependencyManager.resolve(JwsService);
    const kmsKeyId = await getKmsKeyIdForDid(agent, issuerDid, verificationMethodId);

    return jwsService.createJwsCompact(agent.context, {
        keyId: kmsKeyId,
        payload,
        protectedHeaderOptions: header,
    });
}

export async function checkAndCreateStatusList(agent: Agent, listId: string, issuerDid: string, listSize?: number) {
    const uri = `${getServerUrl()}/${STATUS_LISTS_PATH}/${listId}`;

    try {
        const res = await fetch(uri, {
            headers: getApiKeyHeaders()
        });

        if (res.status === 404) {
            console.log(`Status list ${listId} not found, creating a new one...`);
            const size = listSize || Number(process.env.STATUS_LIST_DEFAULT_SIZE);
            const statusList = new StatusList(new Array(size).fill(0), 1);

            const didDocument = await agent.dids.resolve(issuerDid);
            const verificationMethod = didDocument.didDocument?.verificationMethod?.[0];

            if (!verificationMethod) {
                throw new Error(`Could not find verification method for DID ${issuerDid}`);
            }

            const keyId = verificationMethod.id;

            const jwt = await signStatusList(agent, keyId, statusList, listId, issuerDid);
            const postRes = await fetch(`${getServerUrl()}/${STATUS_LISTS_PATH}`, {
                method: 'POST',
                headers: getApiKeyHeaders(),
                body: JSON.stringify({ id: listId, jwt }),
            });

            if (!postRes.ok) {
                const errBody = await postRes.text();
                throw new Error(`Failed to create list on server: ${postRes.status} ${errBody}`);
            }

            console.log(`Successfully created and published new status list ${listId}`);
        } else if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Failed to check status list ${listId} at ${uri}: ${res.status} ${res.statusText} ${errBody}`);
        }
    } catch (error) {
        console.error(`Error in checkAndCreateStatusList:`, error);
        throw error;
    }
}

export async function revokeCredentialInStatusList(agent: Agent, listId: string, index: number, issuerDid: string) {
    const previousLock = statusListLocks.get(listId) || Promise.resolve();

    let releaseLock: () => void;
    const currentLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });

    statusListLocks.set(listId, currentLock);

    try {
        await previousLock;

        const uri = `${getServerUrl()}/${STATUS_LISTS_PATH}/${listId}`;

        const res = await fetch(uri, {
            headers: getApiKeyHeaders(),
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Failed to fetch status list to revoke at ${uri}: ${res.status} ${res.statusText} ${errBody}`);
        }

        const currentJwt = await res.text();
        const statusList = getListFromStatusListJWT(currentJwt);

        statusList.setStatus(index, 1);

        const didDocument = await agent.dids.resolve(issuerDid);
        const verificationMethod = didDocument.didDocument?.verificationMethod?.[0];
        if (!verificationMethod) throw new Error(`Could not find verification method for DID ${issuerDid}`);
        const keyId = verificationMethod.id;

        const newJwt = await signStatusList(agent, keyId, statusList, listId, issuerDid);

        const patchRes = await fetch(`${getServerUrl()}/${STATUS_LISTS_PATH}/${listId}`, {
            method: 'PATCH',
            headers: getApiKeyHeaders(),
            body: JSON.stringify({ jwt: newJwt }),
        });

        if (!patchRes.ok) {
            const errBody = await patchRes.text();
            throw new Error(`Failed to update status list on server: ${patchRes.status} ${errBody}`);
        }
    } finally {
        releaseLock!();
        if (statusListLocks.get(listId) === currentLock) {
            statusListLocks.delete(listId);
        }
    }
}
