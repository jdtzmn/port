/**
 * Unique server identifier generated at module load time.
 * Each server process gets a unique UUID that persists across requests.
 */
export const serverId = crypto.randomUUID()
