import { describe, expect, test } from 'vitest'
import { parseEnterUrl } from './enterUrl.ts'

describe('enter URL matching', () => {
  test('matches GitHub issue and PR URLs, including browser query and fragment', () => {
    expect(parseEnterUrl('https://github.com/Acme/api/issues/42/?tab=comments#discussion')).toEqual({
      kind: 'github-issue', owner: 'Acme', repo: 'api', number: 42,
    })
    expect(parseEnterUrl('https://github.com/acme/api/pull/57')).toEqual({
      kind: 'github-pr', owner: 'acme', repo: 'api', number: 57,
    })
  })

  test('returns null for ordinary branch names', () => {
    expect(parseEnterUrl('feature/auth')).toBeNull()
    expect(parseEnterUrl('my branch')).toBeNull()
  })

  test.each([
    'http://github.com/acme/api/issues/1',
    'https://evil.example/acme/api/issues/1',
    'https://github.com.evil.example/acme/api/issues/1',
    'https://user@github.com/acme/api/issues/1',
    'https://github.com:443/acme/api/issues/1/extra',
    'https://github.com/acme/api/issues/0',
    'https://github.com/acme/api/issues/999999999999999999999',
    'https://github.com/acme/api/issues/%31',
    'https://github.com/acme/api/tree/main',
    'https:/github.com/acme/api/issues/1',
  ])('rejects unsupported or malformed URL %s', input => {
    expect(() => parseEnterUrl(input)).toThrow()
  })
})
