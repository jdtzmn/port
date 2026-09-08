import { describe, expect, test } from 'vitest'
import { parseSshConnectionIdentity as parse } from './sshConnectionIdentity.ts'

const base = 'hostname Example.COM\nport 22\nuser Alice\n'
describe('SSH addressing identity', () => {
  test('normalizes hostname only, ignores typed aliases and unrelated fields', () => {
    expect(parse(base)).toEqual(
      parse(
        'host alternate\nuser Alice\nport 22\nhostname example.com\nidentityfile a\nidentityfile b\n'
      )
    )
    expect(parse(base)?.hostname).toBe('example.com')
    expect(parse(base.replace('Example.COM', '2001:DB8::1'))?.hostname).toBe('2001:db8::1')
    expect(parse(base)).toEqual(
      parse(
        base +
          'proxycommand none\nproxyjump none\nproxyusefdpass no\nhostkeyalias none\nbindaddress none\nbindinterface none\n'
      )
    )
  })
  test.each(['user', 'port', 'hostname'])('requires exactly one %s', key => {
    expect(parse(base + `${key} duplicate\n`)).toBeNull()
    expect(
      parse(
        base
          .split('\n')
          .filter(line => !line.startsWith(key + ' '))
          .join('\n')
      )
    ).toBeNull()
  })
  test.each([
    'proxycommand',
    'proxyjump',
    'proxyusefdpass',
    'hostkeyalias',
    'bindaddress',
    'bindinterface',
  ])('validates and hashes %s', key => {
    const value =
      key === 'proxyusefdpass'
        ? 'yes'
        : key === 'proxycommand'
          ? 'exec proxy --password=secret'
          : 'example'
    expect(parse(base + `${key} ${value}\n`)).not.toEqual(parse(base))
    expect(parse(base + `${key} ${value}\n${key} ${value}\n`)).toBeNull()
    expect(parse(base + `${key} \n`)).toBeNull()
  })
  test('distinguishes user, port and exact proxy context', () => {
    expect(parse(base.replace('Alice', 'alice'))).not.toEqual(parse(base))
    expect(parse(base.replace('22', '2222'))).not.toEqual(parse(base))
    expect(parse(base + 'proxycommand proxy secret1\n')).not.toEqual(
      parse(base + 'proxycommand proxy secret2\n')
    )
    expect(JSON.stringify(parse(base + 'proxycommand proxy secret1\n'))).not.toContain('secret1')
  })
  test.each(['0', '65536', '-1', '22.0', '22 extra', ''])('rejects port %j', port => {
    expect(parse(base.replace('port 22', `port ${port}`))).toBeNull()
  })
  test.each(['a b', 'a\tb', 'a\u0000b', 'a\u007fb', '', 'a'.repeat(1025)])(
    'rejects malformed tokens',
    value => {
      expect(parse(base.replace('Example.COM', value))).toBeNull()
      expect(parse(base.replace('Alice', value))).toBeNull()
    }
  )
  test('bounds input and proxy commands and rejects malformed context', () => {
    expect(parse(base + 'proxycommand ' + 'x'.repeat(8193))).toBeNull()
    expect(parse(base + 'x'.repeat(65536))).toBeNull()
    expect(parse(base + 'proxyusefdpass maybe\n')).toBeNull()
    expect(parse(base + 'bindaddress two words\n')).toBeNull()
    expect(parse(base + 'proxycommand x\ty\n')).toBeNull()
  })
})
