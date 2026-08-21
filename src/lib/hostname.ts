import { sanitizeBranchName } from './sanitize.ts'

export const HOSTNAME_LABEL_LIMIT = 63

export interface HostnameClaim {
  repo: string
  branch: string
}

export function formatHostnameLabel(branch: string): string {
  const sanitized = sanitizeBranchName(branch)

  if (!sanitized || sanitized.length <= HOSTNAME_LABEL_LIMIT) {
    return sanitized || 'port'
  }

  const truncated = sanitized.slice(0, HOSTNAME_LABEL_LIMIT).replace(/-+$/g, '')
  return truncated || 'port'
}

export function formatHostname(branch: string, domain: string): string {
  return `${formatHostnameLabel(branch)}.${domain}`
}

export function findHostnameLabelCollisions(
  candidateRepo: string,
  candidateBranch: string,
  claims: HostnameClaim[]
): HostnameClaim[] {
  const candidateLabel = formatHostnameLabel(candidateBranch)

  return claims.filter(claim => {
    if (claim.repo === candidateRepo && claim.branch === candidateBranch) {
      return false
    }

    return formatHostnameLabel(claim.branch) === candidateLabel
  })
}
