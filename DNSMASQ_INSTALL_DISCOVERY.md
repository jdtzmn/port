# DNSmasq Install/Uninstall Path Discovery

**Epic:** jdtzmn-port--d7xmi-mn88nol7vol  
**Task:** jdtzmn-port--d7xmi-mn88nolg9z2  
**Date:** 2026-03-26  
**Agent:** WiseStar

## Executive Summary

This document provides a complete map of dnsmasq installation and uninstallation logic in the Port CLI. The user has requested explicit confirmation prompts before both installing and uninstalling dnsmasq.

**Current State:**

- ✅ Confirmation prompt EXISTS for `port install` (lines 423-437 in install.ts)
- ✅ Confirmation prompt EXISTS for `port uninstall` (lines 248-263 in uninstall.ts)
- ❓ User wants to ADD/MODIFY prompts specifically for dnsmasq package installation

**Key Finding:** The confirmation prompts currently ask about "DNS configuration" broadly. The user may want more specific prompts that explicitly mention dnsmasq package installation.

---

## Project Structure

**Type:** TypeScript/Bun CLI tool  
**Entry Point:** `src/index.ts`  
**Package Manager:** Bun  
**Command Framework:** Commander.js  
**Prompting Library:** Inquirer.js

---

## Install Flow (`port install`)

### Command Registration

**File:** `src/index.ts`  
**Lines:** 88-98

```typescript
program
  .command('install')
  .description('Set up DNS to resolve wildcard domain used by this repo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--dns-ip <address>', 'IP address wildcard domains should resolve to')
  .option('--domain <domain>', 'Domain suffix to configure')
  .action(install)
```

**Key Options:**

- `-y, --yes`: Skips ALL confirmation prompts (including dnsmasq install)
- `--dns-ip`: Defaults to `127.0.0.1`
- `--domain`: Defaults to config domain or 'port'

---

### Main Install Function

**File:** `src/commands/install.ts`  
**Function:** `install(options?: { yes?: boolean; dnsIp?: string; domain?: string })`  
**Lines:** 387-473

**Flow:**

1. Validate DNS IP (lines 393-399)
2. Resolve domain from config or default (line 401)
3. Check if already configured (lines 404-411)
4. Get platform-specific instructions (line 414)
5. **Confirmation prompt** (lines 422-438) - Can bypass with `-y`
6. Execute platform-specific install (lines 442-448)
7. Verify DNS works (lines 456-472)

---

### macOS Install Function

**File:** `src/commands/install.ts`  
**Function:** `installMacOS(dnsIp: string, domain: string)`  
**Lines:** 75-194

**DNSmasq Installation Logic:**

#### 1. Check Homebrew Installed

**Lines:** 77-81

```typescript
if (!(await commandExists('brew'))) {
  output.error('Homebrew is required but not installed.')
  output.info('Install Homebrew from https://brew.sh')
  return false
}
```

#### 2. Check if dnsmasq Already Installed

**Lines:** 83-97

```typescript
const dnsmasqInstalled = await commandExists('dnsmasq')

if (!dnsmasqInstalled) {
  output.info('Installing dnsmasq via Homebrew...')
  try {
    await execAsync('brew install dnsmasq') // ← ACTUAL INSTALL
    output.success('dnsmasq installed')
  } catch (error) {
    output.error(`Failed to install dnsmasq: ${error}`)
    return false
  }
} else {
  output.dim('dnsmasq already installed')
}
```

**⚠️ KEY INSIGHT:** This is where `brew install dnsmasq` runs. It's **NOT prompted separately** - only the overall DNS configuration is prompted.

#### 3. Configure dnsmasq

**Lines:** 108-130

- Writes to `${brewPrefix}/etc/dnsmasq.conf`
- Adds `address=/${domain}/${dnsIp}` line

#### 4. Create Resolver File

**Lines:** 136-161

- Creates `/etc/resolver/${domain}` with privileged access
- Contains `nameserver ${dnsIp}`

#### 5. Start/Restart dnsmasq Service

**Lines:** 163-191

```typescript
const serviceCommand = dnsmasqRunning
  ? `${brewPrefix}/bin/brew services restart dnsmasq`
  : `${brewPrefix}/bin/brew services start dnsmasq`

await execPrivileged(serviceCommand) // ← Uses macOS auth dialog or sudo
```

---

### Linux Install Functions

#### Dual-Mode (dnsmasq + systemd-resolved)

**File:** `src/commands/install.ts`  
**Function:** `installLinuxDualMode(dnsIp: string, domain: string)`  
**Lines:** 222-309

**DNSmasq Installation Logic:**
**Lines:** 224-235

```typescript
if (!(await commandExists('dnsmasq'))) {
  output.info('Installing dnsmasq...')
  try {
    await execPrivileged('apt-get update && apt-get install -y dnsmasq') // ← INSTALL
    output.success('dnsmasq installed')
  } catch (error) {
    output.error(`Failed to install dnsmasq: ${error}`)
    return printLinuxManualInstructions(dnsIp, domain)
  }
} else {
  output.dim('dnsmasq already installed')
}
```

**Configuration:**

- Writes to `/etc/dnsmasq.d/port-global.conf` with `port=5354`
- Writes to `/etc/dnsmasq.d/${domain}.conf` with address mapping
- Configures systemd-resolved to forward to dnsmasq

#### Standalone Mode (dnsmasq only)

**File:** `src/commands/install.ts`  
**Function:** `installLinuxStandalone(dnsIp: string, domain: string)`  
**Lines:** 317-356

**DNSmasq Installation Logic:**
**Lines:** 318-330 (identical to dual-mode check)\*\*

---

### Existing Confirmation Prompt

**File:** `src/commands/install.ts`  
**Lines:** 422-438

```typescript
// Confirm with user (skip if -y flag is provided)
if (!options?.yes) {
  output.newline()
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Configure DNS to resolve *.${domain} to ${dnsIp}?`,
      default: true,
    },
  ])

  if (!confirm) {
    output.dim('DNS setup cancelled')
    return
  }
}
```

**⚠️ CURRENT BEHAVIOR:** This prompt asks about DNS configuration generally. It does NOT specifically mention:

- Installing the dnsmasq package
- Requiring Homebrew (macOS)
- Requiring apt-get/sudo (Linux)

---

## Uninstall Flow (`port uninstall`)

### Command Registration

**File:** `src/index.ts`  
**Lines:** 158-164

```typescript
program
  .command('uninstall')
  .description('Remove DNS configuration for wildcard domain used by this repo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--domain <domain>', 'Domain suffix to remove')
  .action(uninstall)
```

---

### Main Uninstall Function

**File:** `src/commands/uninstall.ts`  
**Function:** `uninstall(options?: { yes?: boolean; domain?: string })`  
**Lines:** 227-305

**Flow:**

1. Resolve domain (line 228)
2. Check if DNS is configured (lines 231-238)
3. Validate platform (lines 240-246)
4. **Confirmation prompt** (lines 248-264)
5. Execute platform-specific uninstall (lines 268-274)
6. Verify DNS removed (lines 282-304)

---

### macOS Uninstall Function

**File:** `src/commands/uninstall.ts`  
**Function:** `uninstallMacOS(domain: string)`  
**Lines:** 63-112

**Actions:**

1. Remove domain config from `dnsmasq.conf` (lines 75-88)
2. Delete `/etc/resolver/${domain}` file (lines 90-98)
3. Restart dnsmasq if running (lines 100-109)

**⚠️ KEY INSIGHT:** Uninstall does NOT remove the dnsmasq package itself. It only removes configuration for the specific domain.

---

### Linux Uninstall Functions

#### Dual-Mode Uninstall

**File:** `src/commands/uninstall.ts`  
**Function:** `uninstallLinuxDualMode(domain: string)`  
**Lines:** 118-169

**Actions:**

1. Delete `/etc/dnsmasq.d/${domain}.conf`
2. Delete `/etc/dnsmasq.d/port-global.conf` if no other domains remain
3. Restart dnsmasq service
4. Delete `/etc/systemd/resolved.conf.d/${domain}.conf`
5. Restart systemd-resolved

#### Standalone Uninstall

**File:** `src/commands/uninstall.ts`  
**Function:** `uninstallLinuxStandalone(domain: string)`  
**Lines:** 175-199

**Actions:**

1. Delete `/etc/dnsmasq.d/${domain}.conf`
2. Restart dnsmasq service

---

### Existing Confirmation Prompt

**File:** `src/commands/uninstall.ts`  
**Lines:** 248-264

```typescript
// Confirm with user (skip if -y flag is provided)
if (!options?.yes) {
  output.newline()
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove DNS configuration for *.${domain} domains?`,
      default: false, // ← Note: defaults to NO
    },
  ])

  if (!confirm) {
    output.dim('Uninstall cancelled')
    return
  }
}
```

**⚠️ CURRENT BEHAVIOR:** Defaults to `false` (safer for destructive action). Asks about removing DNS configuration, not uninstalling dnsmasq package.

---

## Helper Functions & Utilities

### Privilege Execution

**File:** `src/lib/exec.ts`  
**Function:** `execPrivileged(command: string, options?)`  
**Lines:** 85-142

**Behavior:**

- **macOS GUI session:** Uses `osascript` to show native auth dialog
- **Non-GUI/SSH/Linux:** Uses `sudo`

**Relevant for:**

- Installing dnsmasq package
- Writing to `/etc/resolver/`, `/etc/dnsmasq.d/`, `/etc/systemd/resolved.conf.d/`
- Starting/stopping system services

---

### File Operations

**File:** `src/lib/fileOps.ts`

**Key Functions:**

- `fileOps.read(path)`: Read file contents
- `fileOps.write(path, content, { privileged: true })`: Write with sudo
- `fileOps.append(path, content)`: Append to file
- `fileOps.delete(path, { privileged: true })`: Delete with sudo
- `fileOps.exists(path)`: Check if file exists
- `fileOps.removeLines(path, pattern)`: Remove matching lines

---

### DNS Utilities

**File:** `src/lib/dns.ts`

**Constants:**

- `DEFAULT_DNS_IP = '127.0.0.1'`
- `DEFAULT_DOMAIN = 'port'`
- `DNSMASQ_ALT_PORT = 5354` (for dual-mode Linux)

**Functions:**

- `checkDns(domain, dnsIp)`: Verify DNS resolves correctly
- `getDnsSetupInstructions(dnsIp, domain)`: Get platform-specific manual instructions
- `isSystemdResolvedRunning()`: Check if systemd-resolved is active (Linux)
- `isPortInUse(port)`: Check if port is occupied

---

## Suggested Ownership Boundaries for Implementation

Based on the analysis, here are recommended task splits for adding more specific dnsmasq install/uninstall prompts:

### Task 1: Add Pre-Install Confirmation for dnsmasq Package

**Scope:** Modify install flow to ask specifically about installing dnsmasq
**Files to Touch:**

- `src/commands/install.ts` - Add new prompt before `brew install dnsmasq` and `apt-get install dnsmasq`

**Suggested Prompt Locations:**

#### macOS - Before Line 89:

```typescript
// NEW: Confirm dnsmasq installation specifically
if (!dnsmasqInstalled && !options?.yes) {
  const { confirmInstall } = await inquirer.prompt<{ confirmInstall: boolean }>([
    {
      type: 'confirm',
      name: 'confirmInstall',
      message: 'Install dnsmasq via Homebrew?',
      default: true,
    },
  ])

  if (!confirmInstall) {
    output.dim('dnsmasq installation skipped')
    return printMacOSManualInstructions(dnsIp, domain)
  }
}

await execAsync('brew install dnsmasq')
```

#### Linux - Before Lines 227 and 322:

Similar pattern for `apt-get install -y dnsmasq`

**Considerations:**

- Should respect `-y` flag to skip this new prompt
- May want to combine with existing DNS config prompt or keep separate
- Need to decide: if user says no, show manual instructions or abort?

---

### Task 2: Add Pre-Uninstall Warning for Shared dnsmasq Usage

**Scope:** Warn user if other Port domains are using dnsmasq before uninstalling
**Files to Touch:**

- `src/commands/uninstall.ts` - Add check before removing configs

**Suggested Logic:**

#### macOS - Before Line 81:

```typescript
// NEW: Check if other domains are using dnsmasq
const allDomains = await getConfiguredDomains(dnsmasqConf)
if (allDomains.length > 1) {
  output.warn(`dnsmasq is also configured for: ${allDomains.filter(d => d !== domain).join(', ')}`)
  output.info('Only removing configuration for .${domain} - dnsmasq will remain running.')
}
```

#### Linux - Similar check in both dual-mode and standalone functions

**Considerations:**

- Need to parse dnsmasq.conf to find all `address=/<domain>/` entries
- Only show warning, don't block (since we're only removing config, not uninstalling package)

---

### Task 3: Add Optional Full dnsmasq Uninstall

**Scope:** Offer to uninstall dnsmasq package when removing last domain
**Files to Touch:**

- `src/commands/uninstall.ts` - Add optional package removal step

**Suggested Logic:**

#### After removing last domain config:

```typescript
// NEW: Offer to uninstall dnsmasq if no domains remain
const remainingDomains = await getConfiguredDomains(dnsmasqConf)
if (remainingDomains.length === 0 && !options?.yes) {
  const { uninstallPackage } = await inquirer.prompt<{ uninstallPackage: boolean }>([
    {
      type: 'confirm',
      name: 'uninstallPackage',
      message: 'No Port domains remaining. Uninstall dnsmasq package?',
      default: false, // Conservative default
    },
  ])

  if (uninstallPackage) {
    if (platform === 'darwin') {
      await execAsync('brew uninstall dnsmasq')
      await execAsync('brew services stop dnsmasq')
    } else if (platform === 'linux') {
      await execPrivileged('apt-get remove -y dnsmasq')
    }
    output.success('dnsmasq uninstalled')
  }
}
```

**Considerations:**

- This is destructive - user might have other non-Port uses of dnsmasq
- Default should be `false`
- Should only offer if truly no domains remain in config

---

## Test Coverage

### Install Tests

**File:** `src/commands/install.test.ts`  
**Coverage:**

- Domain resolution from config (lines 82-130)
- dnsmasq restart when adding domain (lines 132-197)
- Existing tests mock `execAsync` and `execPrivileged`

**Testing Strategy for New Prompts:**

- Mock `inquirer.prompt` to return confirm/deny
- Verify `brew install dnsmasq` is/isn't called based on response
- Verify fallback to manual instructions when declined

---

### Uninstall Tests

**File:** `src/commands/uninstall.test.ts`  
**Coverage:**

- Basic uninstall flow (lines 73+)
- Tests mock file operations and commands

**Testing Strategy for New Logic:**

- Mock config parsing to return multiple domains
- Verify warning messages appear
- Test package uninstall only when last domain removed

---

## Dependencies & External Tools

### Runtime Dependencies

- **inquirer** (v9.2.0): User prompts
- **commander** (v12.0.0): CLI framework

### Platform-Specific Requirements

#### macOS:

- Homebrew (`brew`)
- `osascript` (for privilege escalation UI)
- `/etc/resolver/` directory support
- `pgrep` command

#### Linux:

- `apt-get` (Debian/Ubuntu)
- `systemctl` (systemd)
- `sudo` access
- Optional: `systemd-resolved`

---

## Edge Cases & Considerations

### 1. User Already Has dnsmasq Installed

**Current:** Skips installation, configures existing instance  
**Proposed:** Still show prompt explaining what will be configured?

### 2. dnsmasq Installed by Other Tool

**Current:** Port assumes it can manage dnsmasq.conf  
**Proposed:** Detect if config file has non-Port entries, warn user

### 3. Multiple Port Projects with Different Domains

**Current:** All share same dnsmasq instance  
**Proposed:** Clearly communicate this in prompts

### 4. Homebrew vs MacPorts vs Manual Install

**Current:** Only supports Homebrew  
**Proposed:** Detect if dnsmasq exists but not via Homebrew, offer guidance

### 5. Linux Without apt-get

**Current:** Only supports apt-based distros  
**Proposed:** More graceful fallback to manual instructions

---

## Recommended Next Steps

### For Coordinator:

1. **Clarify user intent:** Does user want:
   - More explicit "Installing dnsmasq package" message?
   - Separate confirmation before package install?
   - Warning about dnsmasq being shared across domains?
   - Option to uninstall dnsmasq package on last domain removal?

2. **Choose implementation approach:**
   - Single task: Add all prompts in one pass
   - Split tasks: Install prompts separate from uninstall prompts
   - Phased: Start with install, then uninstall based on feedback

3. **Define prompt text:**
   - Draft exact wording for new prompts
   - Decide on default values (true/false)
   - Determine `-y` flag behavior for each prompt

### For Implementation Worker(s):

**Prerequisites:**

- Read this discovery document
- Review existing test patterns in `install.test.ts` and `uninstall.test.ts`
- Understand inquirer.js prompt API

**Files to Reserve:**

- `src/commands/install.ts` (install flow changes)
- `src/commands/uninstall.ts` (uninstall flow changes)
- `src/commands/install.test.ts` (test updates)
- `src/commands/uninstall.test.ts` (test updates)
- Possibly `src/lib/dns.ts` (if adding domain detection helper)

**Development Approach:**

1. Write failing tests for new prompts
2. Implement prompt logic
3. Update tests to pass
4. Manual testing on macOS and Linux (or Docker container)

---

## Summary

**✅ Current Confirmation Prompts:**

- Install: "Configure DNS to resolve \*.{domain} to {ip}?" (default: true)
- Uninstall: "Remove DNS configuration for \*.{domain} domains?" (default: false)

**⚠️ Gap Identified:**

- Neither prompt explicitly mentions installing/configuring the **dnsmasq package**
- Users might not realize `port install` will run `brew install dnsmasq` or `apt-get install dnsmasq`

**🎯 Recommended Implementation:**

- Add dnsmasq-specific prompts before package installation
- Keep them separate from DNS config confirmation for clarity
- Respect `-y` flag to skip all prompts
- Show informative messages about what's being installed/configured

**📋 Files Identified:**

- **Primary:** `src/commands/install.ts`, `src/commands/uninstall.ts`
- **Tests:** `src/commands/install.test.ts`, `src/commands/uninstall.test.ts`
- **Utilities:** `src/lib/exec.ts`, `src/lib/fileOps.ts`, `src/lib/dns.ts`
- **Entry Point:** `src/index.ts` (command registration)

**🔧 Key Functions:**

- `install()` - lines 387-473 in install.ts
- `installMacOS()` - lines 75-194 in install.ts
- `installLinuxDualMode()` - lines 222-309 in install.ts
- `installLinuxStandalone()` - lines 317-356 in install.ts
- `uninstall()` - lines 227-305 in uninstall.ts
- `uninstallMacOS()` - lines 63-112 in uninstall.ts

---

**Agent:** WiseStar  
**Status:** Path discovery complete ✓  
**Next:** Awaiting coordinator guidance on implementation approach
