import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Starts the built agent-controller with no Indy ledger (`indyLedger: []`, no `BCOVRIN_TEST_GENESIS`) and a throw-away
 * SQLite wallet, then exercises it over HTTP. Nothing is mocked. Opt-in: run `yarn test:no-indy`, which builds first.
 */
const enabled = process.env.NO_INDY_LEDGER_INTEGRATION === '1'
const describeLive = enabled ? describe : describe.skip

const repoRoot = resolve(__dirname, '..', '..')
const adminPort = Number(process.env.NO_INDY_LEDGER_ADMIN_PORT ?? 4311)
const didcommPort = Number(process.env.NO_INDY_LEDGER_DIDCOMM_PORT ?? 4312)
const agentUrl = `http://127.0.0.1:${adminPort}`
const apiKey = 'no-indy-ledger-api-key-16'

async function call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${agentUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      ...(init.token ? { authorization: init.token } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  const text = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { text }
  }
  return { status: response.status, body }
}

describeLive('agent-controller without an Indy ledger', () => {
  let workDir: string
  let agent: ChildProcess
  let output = ''
  let rootToken: string
  let tenantToken: string

  beforeAll(async () => {
    if (!existsSync(join(repoRoot, 'build', 'cli.js'))) {
      throw new Error('build/ is missing: run `yarn build` (or `yarn test:no-indy`) first')
    }

    workDir = mkdtempSync(join(tmpdir(), 'no-indy-ledger-'))
    const configPath = join(workDir, 'cliConfig.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        label: 'No Indy ledger',
        walletId: 'no-indy-ledger',
        walletKey: 'no-indy-ledger',
        walletType: 'sqlite',
        walletUrl: 'unused',
        walletAccount: 'unused',
        walletPassword: 'unused',
        walletAdminAccount: 'unused',
        walletAdminPassword: 'unused',
        walletScheme: 'ProfilePerWallet',
        walletMaxConnections: 5,
        walletConnectTimeout: 30,
        walletIdleTimeout: 30,
        indyLedger: [],
        endpoint: [`http://127.0.0.1:${didcommPort}`],
        logLevel: 2,
        inboundTransport: [{ transport: 'http', port: didcommPort }],
        outboundTransport: ['http'],
        adminPort,
        tenancy: true,
      }),
    )

    // A minimal environment on purpose: no BCOVRIN_TEST_GENESIS, and HOME points at the temp dir so the SQLite
    // wallet lands there and is removed afterwards.
    agent = spawn(process.execPath, [join(repoRoot, 'bin', 'afj-rest.js'), 'start', '--config', configPath], {
      cwd: workDir,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: workDir,
        AGENT_HTTP_URL: `http://127.0.0.1:${didcommPort}`,
        API_KEY: apiKey,
        PURGE_ENABLED: 'false',
        TRUST_LIST_URL: 'http://trust-list.invalid',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    agent.stdout?.on('data', (chunk) => (output += chunk.toString()))
    agent.stderr?.on('data', (chunk) => (output += chunk.toString()))

    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (agent.exitCode !== null) throw new Error(`agent exited with ${agent.exitCode}:\n${output}`)
      try {
        const token = await call('/agent/token', { method: 'POST', token: apiKey })
        if (token.status === 200) {
          rootToken = token.body.token as string
          return
        }
      } catch {
        // not listening yet
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
    throw new Error(`agent did not start within 90s:\n${output}`)
  }, 120_000)

  afterAll(async () => {
    if (agent && agent.exitCode === null) {
      const exited = new Promise((resolveExit) => agent.once('exit', resolveExit))
      agent.kill('SIGTERM')
      await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 10_000).unref())])
      if (agent.exitCode === null) agent.kill('SIGKILL')
    }
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  it('starts without Indy and says so', () => {
    expect(rootToken).toEqual(expect.any(String))
    expect(output).toContain('Indy ledger not configured')
    expect(output).not.toContain('IndyVdrError')
  })

  it('creates a tenant and a did:web', async () => {
    const tenant = await call('/multi-tenancy/create-tenant', {
      method: 'POST',
      token: rootToken,
      body: { config: { label: 'no-indy-tenant' } },
    })
    expect(tenant.status).toBe(200)
    tenantToken = tenant.body.token as string

    const didWeb = await call('/dids/write', {
      method: 'POST',
      token: tenantToken,
      body: { method: 'web', domain: 'example.com', keyType: 'ed25519', seed: '0000000000000000000000000noindy1' },
    })
    expect(didWeb).toMatchObject({ status: 200 })
    expect(didWeb.body.did).toBe('did:web:example.com')
  })

  it.each([
    [
      'POST /dids/write (did:indy)',
      '/dids/write',
      'POST',
      { method: 'indy', network: 'bcovrin:testnet', keyType: 'ed25519' },
    ],
    [
      'POST /anoncreds/schemas',
      '/anoncreds/schemas',
      'POST',
      { issuerId: 'did:indy:bcovrin:testnet:abc', name: 's', version: '1.0', attributes: ['a'] },
    ],
    ['GET /anoncreds/schemas/:id', '/anoncreds/schemas/abc:2:s:1.0', 'GET', undefined],
    [
      'POST /anoncreds/credential-definitions',
      '/anoncreds/credential-definitions',
      'POST',
      { issuerId: 'did:indy:bcovrin:testnet:abc', schemaId: 'abc:2:s:1.0', tag: 'default' },
    ],
    [
      'GET /anoncreds/credential-definitions/:id',
      '/anoncreds/credential-definitions/abc:3:CL:1:default',
      'GET',
      undefined,
    ],
  ])('%s answers 501 "Indy ledger is not configured"', async (_name, path, method, body) => {
    const result = await call(path, { method, token: tenantToken, body })
    expect(result.status).toBe(501)
    expect(result.body.message).toBe('Indy ledger is not configured')
  })

  it('reports did:indy as an unsupported method instead of crashing', async () => {
    const result = await call(`/dids/${encodeURIComponent('did:indy:bcovrin:testnet:abc')}/resolve`, {
      token: tenantToken,
    })
    expect(result.status).toBeLessThan(500)
  })
})
