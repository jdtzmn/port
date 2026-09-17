/** Commands that can bypass Commander because they take no options or arguments. */
export function isListInvocation(arguments_: readonly string[]): boolean {
  return arguments_.length === 1 && (arguments_[0] === 'list' || arguments_[0] === 'ls')
}
