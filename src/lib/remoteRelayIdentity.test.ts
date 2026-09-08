import { X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { access, readFile, stat, unlink, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { connect, createServer } from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as execution from './exec'
import { createRemoteRelayIdentity } from './remoteRelayIdentity'

afterEach(() => vi.restoreAllMocks())

function mockCommand(
  implementation: (...args: Parameters<typeof execution.execFileAsync>) => Promise<unknown>
) {
  // Production awaits the promise and never consumes its ChildProcess property.
  vi.spyOn(execution, 'execFileAsync').mockImplementation(
    implementation as typeof execution.execFileAsync
  )
}

// Never assert on private key values: failure reporters must not print them.
describe('remote relay identity', () => {
  it('creates distinct P-256 non-CA identities with unique SANs and 30-day expiry', async () => {
    const a = await createRemoteRelayIdentity()
    const b = await createRemoteRelayIdentity()
    expect(a.serverName).toMatch(/^[a-f0-9]{32}\.port-relay\.invalid$/)
    expect(a.serverName === b.serverName).toBe(false)
    expect(a.keyPem === b.keyPem).toBe(false)
    expect(a.certificatePem === b.certificatePem).toBe(false)
    const cert = new X509Certificate(a.certificatePem)
    expect(cert.ca).toBe(false)
    expect(cert.subjectAltName).toBe(`DNS:${a.serverName}`)
    expect(cert.keyUsage).toContain('1.3.6.1.5.5.7.3.1')
    expect(cert.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
    expect(a.expiresAt).toBe(Date.parse(cert.validTo))
    expect(a.expiresAt - Date.now()).toBeGreaterThan(29 * 86400_000)
    expect(a.expiresAt - Date.now()).toBeLessThanOrEqual(30 * 86400_000)
  })

  it('pins the incarnation over real TLS and rejects a wrong pin before application bytes', async () => {
    const identity = await createRemoteRelayIdentity()
    const other = await createRemoteRelayIdentity()
    let received = ''
    let secureConnections = 0
    const server = createServer({ key: identity.keyPem, cert: identity.certificatePem }, socket => {
      secureConnections++
      socket.on('error', () => {})
      socket.on('data', data => {
        received += data.toString()
        socket.end('accepted')
      })
    })
    server.on('tlsClientError', () => {})
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing TCP address')
    const exchange = (ca: string) =>
      new Promise<{ authorized: boolean; response: string }>(resolve => {
        let authorized = false
        let response = ''
        const socket = connect({
          host: '127.0.0.1',
          port: address.port,
          servername: identity.serverName,
          ca,
          rejectUnauthorized: true,
        })
        socket.setTimeout(2000, () => socket.destroy())
        socket.on('secureConnect', () => {
          authorized = socket.authorized
          socket.write('sentinel')
        })
        socket.on('data', data => {
          response += data.toString()
        })
        socket.on('error', () => {})
        socket.on('close', () => resolve({ authorized, response }))
      })
    try {
      const wrong = await exchange(other.certificatePem)
      expect(wrong.authorized).toBe(false)
      expect(wrong.response).toBe('')
      expect(received).toBe('')
      expect(secureConnections).toBe(0)
      const correct = await exchange(identity.certificatePem)
      expect(correct.authorized).toBe(true)
      expect(correct.response).toBe('accepted')
      expect(received).toBe('sentinel')
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it.each([1, 2])('sanitizes command %i failure and removes all owned files', async failureAt => {
    const real = execution.execFileAsync
    let directory = ''
    let calls = 0
    mockCommand(async (file, args, options) => {
      const argv = args as string[]
      directory = dirname(argv[argv.indexOf('-out') + 1]!)
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      expect((await stat(join(directory, 'key.pem'))).mode & 0o777).toBe(0o600)
      expect(options).toMatchObject({ timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 4096 })
      expect(file).toBe('openssl')
      expect(argv.includes('-addext')).toBe(false)
      const config = await readFile(join(directory, 'openssl.cnf'), 'utf8')
      expect(config).toContain('basicConstraints = critical,CA:FALSE')
      if (++calls === failureAt) {
        throw Object.assign(new Error('sensitive command failure'), {
          stdout: 'sensitive',
          stderr: 'sensitive',
        })
      }
      return real(file, argv, options)
    })
    let failure: unknown
    try {
      await createRemoteRelayIdentity()
    } catch (error) {
      failure = error
    }
    expect(failure instanceof Error).toBe(true)
    expect((failure as Error).message).toBe('Unable to create remote relay TLS identity')
    expect((failure as Error).cause).toBeUndefined()
    expect(directory.length > 0).toBe(true)
    await expect(access(directory)).rejects.toThrow()
  })

  it.each(['oversized', 'symlink', 'mismatch'])('rejects %s output and cleans up', async kind => {
    const real = execution.execFileAsync
    const other = kind === 'mismatch' ? await createRemoteRelayIdentity() : undefined
    let directory = ''
    mockCommand(async (file, args, options) => {
      const argv = args as string[]
      const result = await real(file, argv, options)
      directory = dirname(argv[argv.indexOf('-out') + 1]!)
      if (argv[0] === 'req') {
        const key = join(directory, 'key.pem')
        if (kind === 'oversized') await writeFile(key, Buffer.alloc(16385))
        else if (kind === 'symlink') {
          await unlink(key)
          await symlink(join(directory, 'certificate.pem'), key)
        } else if (other) await writeFile(key, other.keyPem)
      }
      return result
    })
    await expect(createRemoteRelayIdentity()).rejects.toThrow(
      'Unable to create remote relay TLS identity'
    )
    await expect(access(directory)).rejects.toThrow()
  })
})
