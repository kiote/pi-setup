#!/usr/bin/env bash
# wait-worktree.sh - wait until a new git worktree exists before you read files in it.
#
#   wait-worktree.sh <worktree-dir> [<relative-file>] [--max 60s] [--every 2s]
#
# Ready = <worktree-dir>/.git exists, `git -C <dir> rev-parse --show-toplevel` works,
# and <relative-file> exists (if given). Use it after a launcher that creates a worktree, `git worktree add`,
# or a mission or subagent that creates the worktree, to avoid ENOENT on the first read.
# Exit codes: 0 = ready (prints "OK <dir>"), 3 = not ready at --max, 2 = usage.
set -u

die() { echo "wait-worktree: $*" >&2; exit 2; }
secs() { local v=$1; case $v in *h) echo $(( ${v%h} * 3600 ));; *m) echo $(( ${v%m} * 60 ));; *s) echo "${v%s}";; *) echo "$v";; esac; }

dir="" file="" max=60 every=2
while [ $# -gt 0 ]; do
  case $1 in
    --max) max=$(secs "${2:-}"); shift 2 ;;
    --every) every=$(secs "${2:-}"); shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) if [ -z "$dir" ]; then dir=$1; elif [ -z "$file" ]; then file=$1; else die "too many arguments"; fi; shift ;;
  esac
done
[ -n "$dir" ] || die "usage: wait-worktree.sh <worktree-dir> [<relative-file>] [--max 60s] [--every 2s]"
case $max$every in *[!0-9]*) die "--max and --every need a number with s, m, or h" ;; esac

ready() {
  [ -e "$dir/.git" ] || { why="no $dir/.git"; return 1; }
  git -C "$dir" rev-parse --show-toplevel >/dev/null 2>&1 || { why="git cannot read $dir"; return 1; }
  [ -z "$file" ] || [ -e "$dir/$file" ] || { why="no $dir/$file"; return 1; }
}

why="" start=$SECONDS
until ready; do
  if [ $(( SECONDS - start )) -ge "$max" ]; then
    echo "NOT READY after ${max}s: $why" >&2
    exit 3
  fi
  sleep "$every"
done
echo "OK $dir${file:+ ($file)} after $(( SECONDS - start ))s"
