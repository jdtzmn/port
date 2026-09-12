import { createPrivateKey, randomBytes, X509Certificate } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileAsync } from '../../exec'

const MAX_PEM_BYTES = 16 * 1024
const FAILURE = 'Unable to create remote relay TLS identity'

async function readPem(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PEM_BYTES) {
      throw new Error(FAILURE)
    }
    const bytes = Buffer.alloc(MAX_PEM_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length === 0 || length > MAX_PEM_BYTES) throw new Error(FAILURE)
    return bytes.toString('utf8', 0, length)
  } finally {
    await file.close()
  }
}

/**
 * Creates a fresh, self-signed P-256 server identity for ONE listener incarnation.
 * Requires an external OpenSSL/LibreSSL executable on PATH (ecparam and req).
 * If unavailable, optional remote integration MUST disable itself, NEVER fall
 * back to plaintext. Trust only this incarnation's certificate and serverName.
 * expiresAt is the certificate's expiration time in Unix milliseconds.
 */
export async function createRemoteRelayIdentity(): Promise<{
  serverName: string
  certificatePem: string
  keyPem: string
  expiresAt: number
}> {
  try {
    const directory = await mkdtemp(join(tmpdir(), 'port-relay-identity-'))
    try {
      await chmod(directory, 0o700)
      const serverName = `${randomBytes(16).toString('hex')}.port-relay.invalid`
      const key = join(directory, 'key.pem')
      const certificate = join(directory, 'certificate.pem')
      const config = join(directory, 'openssl.cnf')
      // Exclusively reserve our own outputs; never overwrite pre-existing files.
      for (const path of [key, certificate]) {
        const file = await open(path, 'wx', 0o600)
        await file.close()
      }
      await writeFile(
        config,
        `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = ext\n[dn]\nCN = ${serverName}\n[ext]\nsubjectAltName = DNS:${serverName}\nbasicConstraints = critical,CA:FALSE\nkeyUsage = digitalSignature\nextendedKeyUsage = serverAuth\n`,
        { flag: 'wx', mode: 0o600 }
      )
      const options = { timeout: 5000, killSignal: 'SIGKILL' as const, maxBuffer: 4096 }
      await execFileAsync(
        'openssl',
        ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key],
        options
      )
      await execFileAsync(
        'openssl',
        [
          'req',
          '-new',
          '-x509',
          '-key',
          key,
          '-sha256',
          '-days',
          '30',
          '-config',
          config,
          '-out',
          certificate,
        ],
        options
      )
      const keyPem = await readPem(key)
      const certificatePem = await readPem(certificate)
      const parsed = new X509Certificate(certificatePem)
      const privateKey = createPrivateKey(keyPem)
      const expiresAt = Date.parse(parsed.validTo)
      const startsAt = Date.parse(parsed.validFrom)
      const now = Date.now()
      if (
        parsed.checkHost(serverName, { subject: 'never' }) !== serverName ||
        !Number.isFinite(expiresAt) ||
        !Number.isFinite(startsAt) ||
        startsAt > now ||
        expiresAt <= now ||
        parsed.ca ||
        !parsed.verify(parsed.publicKey) ||
        !parsed.checkPrivateKey(privateKey) ||
        privateKey.asymmetricKeyType !== 'ec' ||
        privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
      ) {
        throw new Error(FAILURE)
      }
      return { serverName, certificatePem, keyPem, expiresAt }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  } catch {
    // Do not retain causes: child-process errors contain stdout/stderr and paths.
    throw new Error(FAILURE)
  }
}
