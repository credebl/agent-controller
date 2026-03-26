import { JwsProtectedHeaderOptions, JwsService, JwtPayload } from '@credo-ts/core';
import { StatusList, getListFromStatusListJWT } from '@sd-jwt/jwt-status-list';

// We evaluate this at request-time instead of statically so cliAgent config is available
export function getServerUrl() {
    return process.env.STATUS_LIST_SERVER_URL || 'http://localhost:3000';
}

function getApiKeyHeaders() {
    const key = process.env.STATUS_LIST_API_KEY;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) {
        headers['x-api-key'] = key;
    }
    return headers;
}

async function getKmsKeyIdForDid(agent: any, did: string, verificationMethodId: string) {
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

async function signStatusList(agent: any, verificationMethodId: string, statusList: StatusList, listId: string, issuerDid: string): Promise<string> {
    const payload = new JwtPayload({
        iss: issuerDid,
        sub: `${getServerUrl()}/status-lists/${listId}`,
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

    // In v0.6.x, createJwsCompact takes keyId instead of key
    return jwsService.createJwsCompact(agent.context, {
        keyId: kmsKeyId,
        payload,
        protectedHeaderOptions: header,
    });
}

export async function checkAndCreateStatusList(agent: any, listId: string, issuerDid: string, listSize?: number) {
    const uri = `${getServerUrl()}/status-lists/${listId}`;

    try {
        const res = await fetch(uri);

        // If it does not exist (404), we need to create it
        if (res.status === 404) {
            console.log(`Status list ${listId} not found, creating a new one...`);
            // Use provided listSize or fallback to env var (default to 131072)
            const size = listSize || Number(process.env.STATUS_LIST_DEFAULT_SIZE) || 131072;
            const statusList = new StatusList(new Array(size).fill(0), 1);

            const didDocument = await agent.dids.resolve(issuerDid);
            const verificationMethod = didDocument.didDocument?.verificationMethod?.[0];

            if (!verificationMethod) {
                throw new Error(`Could not find verification method for DID ${issuerDid}`);
            }

            // Hack to extract keyId
            const keyId = verificationMethod.id;

            const jwt = await signStatusList(agent, keyId, statusList, listId, issuerDid);

            // Post the new status list back to the server
            const postRes = await fetch(`${getServerUrl()}/status-lists`, {
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
            throw new Error(`Failed to check status list ${listId}: ${res.statusText}`);
        }
    } catch (error) {
        console.error(`Error in checkAndCreateStatusList:`, error);
        throw error;
    }
}

export async function revokeCredentialInStatusList(agent: any, listId: string, index: number, issuerDid: string) {
    const uri = `${getServerUrl()}/status-lists/${listId}`;

    // 1. Fetch current
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to fetch status list to revoke: ${res.statusText}`);

    const currentJwt = await res.text();
    const statusList = getListFromStatusListJWT(currentJwt);

    // 2. Flip the bit
    statusList.setStatus(index, 1);

    // 3. Resolve keyId
    const didDocument = await agent.dids.resolve(issuerDid);
    const verificationMethod = didDocument.didDocument?.verificationMethod?.[0];
    if (!verificationMethod) throw new Error(`Could not find verification method for DID ${issuerDid}`);
    const keyId = verificationMethod.id;

    // 4. Re-sign
    const newJwt = await signStatusList(agent, keyId, statusList, listId, issuerDid);

    // 5. Update the server
    const patchRes = await fetch(`${getServerUrl()}/status-lists/${listId}`, {
        method: 'PATCH',
        headers: getApiKeyHeaders(),
        body: JSON.stringify({ jwt: newJwt }),
    });

    if (!patchRes.ok) {
        const errBody = await patchRes.text();
        throw new Error(`Failed to update status list on server: ${patchRes.status} ${errBody}`);
    }
}
