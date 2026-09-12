import { describe, expect, test } from 'vitest'
import { classifySshInvocation, isEligibleSshConfig } from './invocation.ts'

const reviewedKeys = [
  'IdentityFile',
  'IdentitiesOnly',
  'IdentityAgent',
  'User',
  'HostName',
  'Port',
  'ProxyJump',
  'ProxyCommand',
  'StrictHostKeyChecking',
  'UserKnownHostsFile',
  'GlobalKnownHostsFile',
  'BatchMode',
  'PreferredAuthentications',
  'PasswordAuthentication',
  'PubkeyAuthentication',
  'KbdInteractiveAuthentication',
  'ConnectTimeout',
  'ConnectionAttempts',
]

describe('classifySshInvocation', () => {
  test.each([
    'alias',
    'user@host',
    '192.0.2.1',
    'user@192.0.2.1',
    '::1',
    'user@2001:db8::1',
    '[::1]',
  ])('accepts destination %s unchanged', destination => {
    expect(classifySshInvocation([destination])).toEqual({ destination })
    expect(classifySshInvocation(['--', destination])).toEqual({ destination })
  })

  test.each(['-4', '-6', '-A', '-a', '-C', '-q', '-v', '-vvv', '-t', '-tt', '-x', '-X', '-Y'])(
    'accepts reviewed flag %s and repetitions',
    flag => {
      expect(classifySshInvocation([flag, flag, 'host'])).toEqual({ destination: 'host' })
    }
  )

  test.each(['b', 'c', 'E', 'e', 'F', 'i', 'J', 'l', 'm', 'p'])(
    'accepts attached and separate -%s values',
    option => {
      expect(classifySshInvocation([`-${option}value`, 'host'])).toEqual({ destination: 'host' })
      expect(classifySshInvocation([`-${option}`, 'value', '--', 'host'])).toEqual({
        destination: 'host',
      })
      for (const args of [
        [`-${option}`],
        [`-${option}`, '', 'host'],
        [`-${option}`, '-v', 'host'],
      ]) {
        expect(classifySshInvocation(args)).toBeNull()
      }
    }
  )

  test.each(reviewedKeys)('accepts reviewed -o key %s with either separator', key => {
    for (const separator of ['=', ' ', '\t', ' = ']) {
      expect(
        classifySshInvocation(['-o', `${key.toUpperCase()}${separator}value`, 'host'])
      ).toEqual({ destination: 'host' })
      expect(classifySshInvocation([`-o${key.toLowerCase()}${separator}value`, 'host'])).toEqual({
        destination: 'host',
      })
    }
  })

  test('preserves actual argv entries containing spaces, quotes and unexpanded paths', () => {
    const args = Object.freeze([
      '-F',
      '~/my configs/custom.conf',
      '-i~/my keys/id',
      '-E',
      '/tmp/ssh log',
      '-o',
      'ProxyCommand=sh -c "exec nc %h %p"',
      '-oIdentityFile="~/another key"',
      'user@alias',
    ])
    const before = [...args]
    expect(classifySshInvocation(args)).toEqual({ destination: 'user@alias' })
    expect(args).toEqual(before)
  })

  test.each([
    '-N',
    '-f',
    '-W',
    '-O',
    '-S',
    '-M',
    '-T',
    '-n',
    '-s',
    '-G',
    '-V',
    '-Q',
    '-L',
    '-R',
    '-D',
    '-z',
    '-Av',
    '-vt',
    '-4v',
    '-vvq',
    '--help',
    '-',
  ])('rejects unsafe or unknown flag %s', flag => {
    expect(classifySshInvocation([flag, 'host'])).toBeNull()
    expect(classifySshInvocation([`${flag}value`, 'host'])).toBeNull()
  })

  test.each([
    'RemoteCommand',
    'SessionType',
    'RequestTTY',
    'StdinNull',
    'ForkAfterAuthentication',
    'ControlMaster',
    'ControlPersist',
    'ControlPath',
    'LocalForward',
    'RemoteForward',
    'DynamicForward',
    'UnknownOption',
    'Include',
    'Match',
    'PermitLocalCommand',
    'LocalCommand',
  ])('rejects unreviewed -o key %s', key => {
    expect(classifySshInvocation(['-o', `${key}=none`, 'host'])).toBeNull()
    expect(classifySshInvocation([`-o${key} none`, 'host'])).toBeNull()
  })

  test.each([
    [],
    [''],
    [' '],
    ['--'],
    ['--', ''],
    ['--', '-host'],
    ['host', 'host2'],
    ['host', 'echo hello'],
    ['host', ''],
    ['host', '-t'],
    ['--', 'host', 'command'],
    ['-o'],
    ['-o', 'User'],
    ['-oUser='],
    ['-oUser=   '],
    ['-o', 'User', 'alice', 'host'],
    ['-oUser=alice\nRemoteCommand=bad', 'host'],
    ['host\0'],
    ['host name'],
  ])('falls back for invalid or non-shell argv %j', (...args) => {
    expect(classifySshInvocation(args)).toBeNull()
  })
})

const safeLines = [
  'controlmaster false',
  'controlpersist no',
  'controlpath none',
  'remotecommand none',
  'sessiontype default',
  'stdinnull no',
  'forkafterauthentication no',
  'requesttty auto',
]
const safeOutput = safeLines.join('\n') + '\n'

describe('isEligibleSshConfig', () => {
  test('accepts complete safe output and unrelated SSH fields', () => {
    expect(isEligibleSshConfig(safeOutput)).toBe(true)
    expect(isEligibleSshConfig('host alias\nidentityfile ~/my key\n' + safeOutput)).toBe(true)
    expect(isEligibleSshConfig(safeOutput.toUpperCase().replaceAll('\n', '\r\n'))).toBe(true)
    expect(isEligibleSshConfig(safeOutput.trimEnd())).toBe(true)
    expect(isEligibleSshConfig(safeOutput.replace('controlpath none\n', ''))).toBe(true)
    // OpenSSH omits both fields when no control path or remote command is set.
    expect(
      isEligibleSshConfig(
        safeOutput.replace('controlpath none\n', '').replace('remotecommand none\n', '')
      )
    ).toBe(true)
  })

  test.each(['auto', 'yes', 'force'])('accepts requesttty %s and alternate safe values', tty => {
    expect(
      isEligibleSshConfig(
        safeOutput
          .replace('controlmaster false', 'controlmaster no')
          .replace('controlpersist no', 'controlpersist 0')
          .replace('requesttty auto', `requesttty ${tty}`)
      )
    ).toBe(true)
  })

  test.each(safeLines)('rejects missing required or duplicate policy field %s', line => {
    if (!line.startsWith('controlpath ') && !line.startsWith('remotecommand ')) {
      expect(isEligibleSshConfig(safeOutput.replace(line + '\n', ''))).toBe(false)
    }
    expect(isEligibleSshConfig(safeOutput + line + '\n')).toBe(false)
    expect(isEligibleSshConfig(safeOutput + line.toUpperCase() + '\n')).toBe(false)
  })

  test.each([
    ['controlmaster', 'auto'],
    ['controlmaster', 'yes'],
    ['controlpersist', 'yes'],
    ['controlpersist', '60'],
    ['controlpath', '/tmp/socket'],
    ['remotecommand', 'echo hello'],
    ['sessiontype', 'none'],
    ['sessiontype', 'subsystem'],
    ['stdinnull', 'yes'],
    ['forkafterauthentication', 'yes'],
    ['requesttty', 'no'],
    ['requesttty', 'unknown'],
  ])('rejects unsafe %s %s', (key, value) => {
    const output = safeLines
      .map(line => (line.startsWith(key + ' ') ? `${key} ${value}` : line))
      .join('\n')
    expect(isEligibleSshConfig(output)).toBe(false)
  })

  test.each([
    '',
    '\n',
    'not-ssh-output',
    'controlmaster=false',
    'warning: failed',
    '\0',
    'host\rvalue',
    'host ',
    '\n\n',
  ])('rejects invalid output %j', invalid => {
    expect(isEligibleSshConfig(invalid)).toBe(false)
    expect(isEligibleSshConfig(safeOutput + invalid)).toBe(invalid === '')
  })

  test('does not accept extra tokens or quoted policy values', () => {
    for (const value of ['no extra', '"no"', 'no ', '']) {
      expect(isEligibleSshConfig(safeOutput.replace('stdinnull no', `stdinnull ${value}`))).toBe(
        false
      )
    }
  })
})
