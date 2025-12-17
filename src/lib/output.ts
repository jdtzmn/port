import chalk from 'chalk'

/**
 * Output a success message with a green checkmark
 */
export function success(message: string): void {
  console.log(chalk.green('✓') + ' ' + message)
}

/**
 * Output a warning message with a yellow warning symbol
 */
export function warn(message: string): void {
  console.warn(chalk.yellow('⚠') + ' ' + message)
}

/**
 * Output an error message with a red X
 */
export function error(message: string): void {
  console.error(chalk.red('✗') + ' ' + message)
}

/**
 * Output an info message with a blue arrow
 */
export function info(message: string): void {
  console.log(chalk.blue('→') + ' ' + message)
}

/**
 * Output a dim/muted message (for secondary information)
 */
export function dim(message: string): void {
  console.log(chalk.dim(message))
}

/**
 * Output a header/title in bold
 */
export function header(message: string): void {
  console.log(chalk.bold(message))
}

/**
 * Output a URL in cyan (clickable in most terminals)
 */
export function url(urlString: string): string {
  return chalk.cyan(urlString)
}

/**
 * Output a command in yellow (for showing commands to run)
 */
export function command(cmd: string): string {
  return chalk.yellow(cmd)
}

/**
 * Output a branch/worktree name in magenta
 */
export function branch(name: string): string {
  return chalk.magenta(name)
}

/**
 * Output service URLs in a formatted block
 */
export function serviceUrls(services: Array<{ name: string; urls: string[] }>): void {
  for (const service of services) {
    console.log()
    console.log('  ' + chalk.bold(service.name) + ':')
    for (const serviceUrl of service.urls) {
      console.log('    ' + chalk.dim('•') + ' ' + url(serviceUrl))
    }
  }
}

/**
 * Output a blank line
 */
export function newline(): void {
  console.log()
}
