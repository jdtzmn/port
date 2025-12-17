/**
 * Sanitize a branch name to be a valid hostname component.
 *
 * Transforms branch names like:
 * - "feature/auth-api" → "feature-auth-api"
 * - "fix/bug#123" → "fix-bug-123"
 * - "release_v1.0.0" → "release-v1-0-0"
 * - "HOTFIX-urgent" → "hotfix-urgent"
 *
 * @param branch - The git branch name to sanitize
 * @returns A valid hostname-safe string
 */
export function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/[^a-zA-Z0-9-]/g, '-') // Replace non-alphanumeric (except dash) with dash
    .replace(/-+/g, '-') // Collapse multiple consecutive dashes
    .replace(/^-|-$/g, '') // Remove leading/trailing dashes
    .toLowerCase()
}

/**
 * Sanitize a repo folder name to be a valid hostname component.
 * Uses the same logic as branch name sanitization.
 *
 * @param folderName - The folder name to sanitize
 * @returns A valid hostname-safe string
 */
export function sanitizeFolderName(folderName: string): string {
  return sanitizeBranchName(folderName)
}
