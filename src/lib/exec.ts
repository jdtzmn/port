import { exec } from 'child_process'
import { promisify } from 'util'

/**
 * Promisified version of child_process.exec
 */
export const execAsync = promisify(exec)
