#!/usr/bin/env bash
# git-safe-pull.sh [-C <dir>] [git pull args]
# Pull without a stop on local copies that equal the upstream content. Spec: specs/git-safe-pull.md
# Default mode does not change differing content.
# Opt-in: [-C <dir>] --stash-local --ff-only [-q|--quiet] [<remote> <branch>].
# No other options or refspecs are accepted. Each backup stash is retained.
set -u
export MSYS_NO_PATHCONV=1
script_source=${BASH_SOURCE[0]}
case "$script_source" in /*|[A-Za-z]:/*) ;; *) script_source="$PWD/$script_source" ;; esac
# The sentinel keeps trailing newlines in Git paths. Remove only Git's final LF.
git_path() {
  local value
  value=$(git -c core.quotePath=false rev-parse "$@" && printf '\001') || return 1
  value=${value%$'\001'}
  [[ "$value" = *$'\n' ]] || return 1
  value=${value%$'\n'}
  case "$value" in /*|[A-Za-z]:/*) ;; *) return 1 ;; esac
  printf '%s\001' "$value"
}
if [ "${1:-}" = "-C" ]; then [ "$#" -ge 2 ] || { echo "git-safe-pull: -C needs a directory" >&2; exit 2; }; cd "$2" || { echo "git-safe-pull: no folder $2" >&2; exit 2; }; shift 2; fi
if [ "${1:-}" != --stash-local ]; then
  for arg in "$@"; do
    [ "$arg" != --stash-local ] || { echo "git-safe-pull: --stash-local must be first after -C" >&2; exit 2; }
  done
fi
git rev-parse --git-dir >/dev/null 2>&1 || { echo "git-safe-pull: not a git repo: $(pwd)" >&2; exit 2; }
root_record=$(git_path --show-toplevel) || { echo "git-safe-pull: cannot resolve repository root" >&2; exit 2; }
cd "${root_record%$'\001'}" || exit 2  # porcelain paths are relative to the repo root
export GIT_LITERAL_PATHSPECS=1                     # a name such as pages/[id].tsx must not match other files

if [ "${1:-}" = --stash-local ]; then
  shift
  (
    set -o pipefail
    # Stash uses pathspecs internally. Do not pass a global literal-path setting to it.
    unset GIT_LITERAL_PATHSPECS GIT_GLOB_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_ICASE_PATHSPECS
    fail_local() { echo "git-safe-pull: $*" >&2; exit 1; }
    # These controls apply only to this mode. Ignore inherited automatic stash,
    # submodule recursion, and diff ignore settings. Status uses explicit flags.
    local_git() {
      git -c merge.autoStash=false -c rebase.autoStash=false \
        -c submodule.recurse=false -c fetch.recurseSubmodules=false \
        -c diff.ignoreSubmodules=none "$@"
    }
    repo_root=${root_record%$'\001'}
    [ "${1:-}" = --ff-only ] || fail_local "--stash-local requires --ff-only first"
    shift
    quiet=()
    case "${1:-}" in -q|--quiet) quiet=(-q); shift ;; esac
    operands=("$@")
    for arg in "${operands[@]}"; do
      case "$arg" in -*) fail_local "unsupported option: $arg" ;; esac
    done
    command -v node >/dev/null 2>&1 || fail_local "Node.js is required for repository discovery"
    command -v timeout >/dev/null 2>&1 || fail_local "timeout is required"
    script_dir=$(cd -- "$(dirname -- "$script_source")" && pwd -P && printf '\001') || fail_local "cannot resolve helper directory"
    script_dir=${script_dir%$'\001'}; script_dir=${script_dir%$'\n'}
    case "$OSTYPE" in msys*|cygwin*)
      script_dir=$(cygpath -m -- "$script_dir" && printf '\001') || fail_local "cannot convert helper directory"
      script_dir=${script_dir%$'\001'}; script_dir=${script_dir%$'\n'} ;;
    esac
    discovery_module="$script_dir/git-safe-pull-discovery.mjs"
    [ -f "$discovery_module" ] && [ -r "$discovery_module" ] || fail_local "repository discovery module is missing or unreadable"
    git_record=$(git_path --path-format=absolute --git-dir) || fail_local "cannot resolve absolute Git directory (recent Git required)"
    common_record=$(git_path --path-format=absolute --git-common-dir) || fail_local "cannot resolve absolute common Git directory (recent Git required)"
    git_directory=${git_record%$'\001'}; common_directory=${common_record%$'\001'}
    case ${#operands[@]} in
      0)
        current=$(local_git symbolic-ref --quiet --short HEAD) || fail_local "no current branch"
        remote=$(local_git config --get "branch.$current.remote") || fail_local "no upstream remote"
        branch=$(local_git config --get "branch.$current.merge") || fail_local "no upstream branch"
        ;;
      2) remote=${operands[0]}; branch=${operands[1]} ;;
      *) fail_local "supply both remote and branch, or neither" ;;
    esac
    case "$remote" in ''|-*) fail_local "invalid remote" ;; esac
    case "$branch" in
      refs/heads/*) ;;
      refs/*|''|-*|+*|^*) fail_local "invalid branch: $branch" ;;
      *) branch="refs/heads/$branch" ;;
    esac
    local_git check-ref-format "$branch" || fail_local "invalid branch: $branch"
    for state_path in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply sequencer; do
      resolved=$(local_git rev-parse --git-path "$state_path") || fail_local "cannot check $state_path"
      [ ! -e "$resolved" ] || fail_local "unfinished Git state: $state_path"
    done
    tmp=$(mktemp -d) || fail_local "cannot create temporary folder"
    trap 'rm -f -- "$tmp/"*; rmdir -- "$tmp"' EXIT
    local_git ls-files -u -z > "$tmp/unmerged" || fail_local "cannot check unresolved entries"
    [ ! -s "$tmp/unmerged" ] || fail_local "unresolved index entries"
    timeout 120 git -c submodule.recurse=false -c fetch.recurseSubmodules=false \
      fetch -q --no-recurse-submodules -- "$remote" "$branch" || fail_local "fetch failed"
    target=$(local_git rev-parse --verify 'FETCH_HEAD^{commit}') || fail_local "cannot resolve fetched commit"
    local_git merge-base --is-ancestor HEAD "$target" || fail_local "target is not a fast-forward, or ancestry check failed"

    # Keep paths as NUL-separated records. Check both trees and the index for gitlinks.
    protected=()
    for tree in HEAD "$target"; do
      local_git ls-tree -rz "$tree" > "$tmp/tree" || fail_local "cannot read tree $tree"
      while IFS= read -r -d '' record; do
        [ "${record%% *}" != 160000 ] || protected+=("${record#*$'\t'}")
      done < "$tmp/tree"
    done
    local_git ls-files --stage -z > "$tmp/index" || fail_local "cannot read index"
    while IFS= read -r -d '' record; do
      [ "${record%% *}" != 160000 ] || protected+=("${record#*$'\t'}")
    done < "$tmp/index"
    # Bound both output and time. Only accept a complete, validated result.
    timeout --kill-after=2s 30s node "$discovery_module" "$repo_root" "$git_directory" "$common_directory" |
      head -c 4194305 > "$tmp/discovery"
    discovery_status=("${PIPESTATUS[@]}")
    discovery_bytes=$(wc -c < "$tmp/discovery") || fail_local "cannot size repository discovery"
    [ "$discovery_bytes" -le 4194304 ] || fail_local "repository discovery output limit exceeded"
    case ${discovery_status[0]} in 124|137) fail_local "repository discovery timed out" ;; esac
    [ "${discovery_status[0]}" = 0 ] && [ "${discovery_status[1]}" = 0 ] || fail_local "repository discovery failed (producer ${discovery_status[0]}, consumer ${discovery_status[1]})"
    discovered=()
    read_field() { IFS= read -r -d '' field <&3 || fail_local "incomplete repository discovery stream"; }
    exec 3< "$tmp/discovery" || fail_local "cannot read repository discovery"
    read_field; [ "$field" = git-safe-pull-discovery-v1 ] || fail_local "malformed repository discovery version"
    read_field; [ "$field" = root ] || fail_local "malformed repository discovery root type"
    read_field; [ "$field" = . ] || fail_local "malformed repository discovery root"
    while :; do
      read_field
      case "$field" in
        protected)
          read_field
          case "$field" in ''|/*|[A-Za-z]:/*) fail_local "malformed repository discovery path" ;; esac
          case "$OSTYPE" in msys*|cygwin*|win32*)
            case "$field" in [A-Za-z]:*|*'\'*) fail_local "malformed repository discovery path" ;; esac ;;
          esac
          case "/$field/" in *'//'*|*'/./'*|*'/../'*) fail_local "malformed repository discovery path" ;; esac
          discovered+=("$field")
          [ "${#discovered[@]}" -le 10004 ] || fail_local "malformed repository discovery count"
          ;;
        complete)
          read_field
          [[ "$field" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$field" -le 10000 ] || fail_local "malformed repository discovery count"
          read_field
          # Up to four supplied/canonical metadata roots are outside the directory count.
          [[ "$field" =~ ^(0|[1-9][0-9]{0,4})$ ]] && [ "$field" -le 10004 ] && [ "$field" -eq "${#discovered[@]}" ] || fail_local "malformed repository discovery protected count"
          field=
          if IFS= read -r -d '' field <&3 || [ -n "$field" ]; then fail_local "extra repository discovery record"; fi
          break ;;
        *) fail_local "malformed repository discovery type" ;;
      esac
    done
    exec 3<&-
    protected+=("${discovered[@]}")
    check_protected() {
      local path=$1 repo path_key repo_key
      path=${path%/}
      for repo in "${protected[@]}"; do
        path_key=$path; repo_key=$repo
        # Windows paths can have different spellings for the same directory.
        case "$OSTYPE" in msys*|cygwin*|win32*) path_key=${path_key,,}; repo_key=${repo_key,,} ;; esac
        case "$path_key/" in "$repo_key/"*) fail_local "nested repository or submodule could change: $repo" ;; esac
        case "$repo_key/" in "$path_key/"*) fail_local "nested repository or submodule could change: $repo" ;; esac
      done
    }
    local_git diff --name-only -z --no-renames --ignore-submodules=none HEAD "$target" > "$tmp/changed" || fail_local "cannot compare target"
    while IFS= read -r -d '' path; do check_protected "$path"; done < "$tmp/changed"
    status_local() {
      local_git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none > "$tmp/status"
    }
    status_local || fail_local "cannot read local status"
    while IFS= read -r -d '' record; do
      check_protected "${record:3}"
      case "${record:0:2}" in
        *R*|*C*) IFS= read -r -d '' source <&0 || fail_local "incomplete rename record"; check_protected "$source" ;;
      esac
    done < "$tmp/status"

    removed=0
    while IFS= read -r -d '' record; do
      st=${record:0:2}; path=${record:3}
      case "$st" in
        *R*|*C*) IFS= read -r -d '' source <&0 || fail_local "incomplete rename record"; continue ;;
        ' M'|'??') ;;
        *) continue ;;
      esac
      [ -f "$path" ] && [ ! -L "$path" ] || continue
      local_git --literal-pathspecs ls-tree -z "$target" -- "$path" > "$tmp/entry" || fail_local "cannot inspect target path: $path"
      IFS= read -r -d '' entry < "$tmp/entry" || continue
      header=${entry%%$'\t'*}
      read -r mode type oid <<< "$header"
      [ "$type" = blob ] || continue
      case "$mode" in 100644|100755) ;; *) continue ;; esac
      local_git cat-file blob "$oid" > "$tmp/blob" || fail_local "cannot read target blob: $path"
      cmp -s -- "$tmp/blob" "$path"; compared=$?
      case "$compared" in 0) ;; 1) continue ;; *) fail_local "cannot compare local bytes: $path" ;; esac
      if [ "$st" = '??' ]; then
        rm -- "$path" || fail_local "cannot remove equal copy: $path"
      else
        local_git --literal-pathspecs checkout -q -- "$path" || fail_local "cannot restore equal copy: $path"
      fi
      echo "git-safe-pull: removed local copy equal to upstream: $path"
      removed=$((removed + 1))
    done < "$tmp/status"

    saved=""
    raw_backup=""
    raw_paths=()
    backup_untracked() {
      local record path index=0
      while IFS= read -r -d '' record; do
        case "${record:0:2}" in
          *R*|*C*) IFS= read -r -d '' path || fail_local "incomplete rename record"; continue ;;
          '??') ;;
          *) continue ;;
        esac
        path=${record:3}
        [ -f "$path" ] && [ ! -L "$path" ] || continue
        if [ -z "$raw_backup" ]; then
          raw_backup=$(mktemp -d "$git_directory/git-safe-pull-raw.XXXXXXXX") || fail_local "cannot create raw backup"
          echo "git-safe-pull: retained raw untracked backup: $raw_backup"
          echo "git-safe-pull: raw paths.nul entries map to files 0, 1, ...; inspect before manual recovery"
        fi
        cp -p -- "$path" "$raw_backup/$index" || fail_local "raw backup copy failed: $path"
        cmp -s -- "$path" "$raw_backup/$index" || fail_local "raw backup verification failed: $path"
        printf '%s\0' "$path" >> "$raw_backup/paths.nul" || fail_local "cannot write raw backup manifest"
        raw_paths+=("$path")
        index=$((index + 1))
      done < "$tmp/status"
    }
    restore_untracked() {
      local path index=0
      # Validate all destinations before restoring any bytes. An upstream addition
      # belongs to the merge, even if a filter made stash apply accept its contents.
      for path in "${raw_paths[@]}"; do
        if [ ! -f "$path" ] || [ -L "$path" ]; then
          echo "git-safe-pull: raw restore requires an existing regular file: $path" >&2
          return 1
        fi
        local_git --literal-pathspecs ls-files -z -- "$path" > "$tmp/raw-tracked" || return 1
        if [ -s "$tmp/raw-tracked" ]; then
          echo "git-safe-pull: raw restore refuses tracked destination: $path" >&2
          return 1
        fi
      done
      for path in "${raw_paths[@]}"; do
        if ! cp -p -- "$raw_backup/$index" "$path" || ! cmp -s -- "$raw_backup/$index" "$path"; then
          echo "git-safe-pull: raw restore or verification failed: $path" >&2
          return 1
        fi
        index=$((index + 1))
      done
    }
    recovery() {
      echo "git-safe-pull: retained backup $saved"
      echo "git-safe-pull: recovery in $(pwd): git stash apply --index $saved"
      [ -z "$raw_backup" ] || echo "git-safe-pull: raw untracked bytes and paths.nul retained at: $raw_backup"
    }
    restore_local() {
      [ -n "$saved" ] || return 0
      if local_git stash apply --index "$saved"; then
        if ! restore_untracked; then
          recovery >&2
          return 1
        fi
        echo "git-safe-pull: restore succeeded; backup retained: $saved"
        return 0
      fi
      echo "git-safe-pull: restore failed. Keep the conflict state. Do not apply again before inspection." >&2
      recovery >&2
      return 1
    }
    status_local || fail_local "cannot read status after duplicate cleanup"
    if [ -s "$tmp/status" ]; then
      backup_untracked
      old=$(local_git rev-parse --verify -q refs/stash); old_status=$?
      case $old_status in 0|1) ;; *) fail_local "cannot read prior stash ID" ;; esac
      local_git stash push --include-untracked --message "git-safe-pull backup before $target"
      stash_status=$?
      saved=$(local_git rev-parse --verify -q refs/stash) || fail_local "stash failed; no backup ID is available"
      [ -n "$saved" ] && [ "$saved" != "$old" ] || fail_local "stash did not create a new backup; update stopped"
      recovery
      if [ "$stash_status" != 0 ]; then
        echo "git-safe-pull: stash creation failed; update stopped" >&2
        restore_local
        exit 1
      fi
      if ! status_local; then
        echo "git-safe-pull: cannot read status after stash; update stopped" >&2
        restore_local
        exit 1
      fi
      if [ -s "$tmp/status" ]; then
        echo "git-safe-pull: changes remain after stash; update stopped" >&2
        restore_local
        exit 1
      fi
    fi
    update_status=0
    timeout 300 git -c submodule.recurse=false -c merge.autoStash=false \
      merge "${quiet[@]}" --ff-only --no-squash --no-autostash --no-overwrite-ignore "$target" || update_status=$?
    if [ "$update_status" = 0 ]; then
      if ! updated_head=$(local_git rev-parse --verify HEAD) || [ "$updated_head" != "$target" ]; then
        echo "git-safe-pull: HEAD does not equal the fetched target: $target" >&2
        update_status=1
      fi
    fi
    if [ "$update_status" = 0 ]; then
      echo "git-safe-pull: fast-forward succeeded: $target"
    else
      echo "git-safe-pull: fast-forward failed (exit $update_status)" >&2
    fi
    restore_status=0
    restore_local || restore_status=$?
    [ "$update_status" = 0 ] && [ "$restore_status" = 0 ] || exit 1
    echo "git-safe-pull: OK ($removed local copies equal to upstream removed)"
  )
  exit $?
fi

# The upstream ref: "<remote> <branch>" from the args, else the tracking branch.
remote="" branch=""
for a in "$@"; do
  case "$a" in -*) ;; *) if [ -z "$remote" ]; then remote="$a"; elif [ -z "$branch" ]; then branch="$a"; fi ;; esac
done
if [ -n "$remote" ] && [ -n "$branch" ]; then
  timeout 120 git fetch -q "$remote" "$branch" || { echo "git-safe-pull: fetch failed" >&2; exit 1; }
  up="FETCH_HEAD"
else
  timeout 120 git fetch -q ${remote:+"$remote"} || { echo "git-safe-pull: fetch failed" >&2; exit 1; }
  up=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || { echo "git-safe-pull: no upstream branch" >&2; exit 1; }
fi
upc=$(git rev-parse "$up") || exit 1

state() { # same | differs | new  (local file versus upstream)
  if git cat-file -e "$upc:$1" 2>/dev/null; then
    if [ -f "$1" ] && git show "$upc:$1" | cmp -s - "$1"; then echo same; else echo differs; fi
  else echo new; fi
}

removed=0
while IFS= read -r line; do
  line=${line%$'\r'}; st=${line:0:2}; f=${line:3}
  case "$f" in *" -> "*) continue ;; esac
  [ -d "$f" ] && continue
  case "$st" in " M"|"??") ;; *) continue ;; esac  # only worktree-only changes; staged files stay as they are
  [ "$(state "$f")" = same ] || continue
  if [ "$st" = "??" ]; then rm -f -- "$f"; else git checkout -q -- "$f"; fi
  echo "git-safe-pull: removed local copy equal to upstream: $f"; removed=$((removed + 1))
done < <(git status --porcelain --untracked-files=all)

if timeout 300 git pull "$@"; then
  echo "git-safe-pull: OK ($removed local copies equal to upstream removed)"; exit 0
fi
echo "git-safe-pull: pull failed. Local changes that the upstream also has:" >&2
changed=$(git diff --name-only HEAD "$upc" 2>/dev/null)
while IFS= read -r line; do
  line=${line%$'\r'}; f=${line:3}
  printf '%s\n' "$changed" | grep -qxF -- "$f" || continue
  echo "  ${line:0:2} $(state "$f") $f" >&2
done < <(git status --porcelain --untracked-files=all)
echo "git-safe-pull: these files differ from the upstream. They are unchanged. Compare them with: git diff $upc -- <file>" >&2
exit 1
