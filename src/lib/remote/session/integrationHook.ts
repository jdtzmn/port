/** Optional Bash-only bridge. Arguments and helper output are never evaluated. */
export function generateSshIntegrationHook(): string {
  return `if ! alias ssh >/dev/null 2>&1 && ! declare -F ssh >/dev/null 2>&1; then
  function ssh () (
    if [ ! -t 0 ] || [ ! -t 1 ]; then
      command ssh "$@"
      exit $?
    fi
    __port_ssh_dir=''
    if __port_ssh_dir="$(command port __remote-prepare -- "$@" 2>/dev/null)"; then
      :
    else
      __port_ssh_dir=''
    fi
    case "$__port_ssh_dir" in
      /tmp/port-ssh-[a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9]) ;;
      *) command ssh "$@"; exit $? ;;
    esac
    if [ ! -d "$__port_ssh_dir" ] || [ -L "$__port_ssh_dir" ] || [ ! -O "$__port_ssh_dir" ]; then
      command ssh "$@"
      exit $?
    fi
    __port_ssh_observer=''
    trap '__port_ssh_status=$?; trap - EXIT; trap "" HUP INT TERM; if [ -n "$__port_ssh_observer" ]; then for __port_ssh_live in $(jobs -pr; jobs -ps); do if [ "$__port_ssh_live" = "$__port_ssh_observer" ]; then kill -KILL "$__port_ssh_observer" 2>/dev/null || :; fi; done; wait "$__port_ssh_observer" 2>/dev/null || :; fi; command port __remote-cleanup "$__port_ssh_dir" </dev/null >/dev/null 2>&1 || :; exit "$__port_ssh_status"' EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    command port __remote-observe "$__port_ssh_dir" </dev/null >/dev/null 2>&1 &
    __port_ssh_observer=$!
    if command ssh -o ControlMaster=yes -o ControlPersist=5 -o "ControlPath=$__port_ssh_dir/s" "$@"; then
      __port_ssh_status=0
    else
      __port_ssh_status=$?
    fi
    exit "$__port_ssh_status"
  )
fi`
}
