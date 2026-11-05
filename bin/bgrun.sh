#!/usr/bin/env bash
# bgrun.sh - start a long run (for example an eval) in the background, then wait for it in short steps.
#
#   bgrun.sh start  <dir> [--replace] -- <command...>
#                                           start with nohup; log to <dir>/bgrun.log, pid to <dir>/bgrun.pid
#                                           if a run is active in <dir>: error, or with --replace stop its
#                                           full process tree first (prevents duplicate watchers)
#   bgrun.sh stop   <dir>                   stop the run and all its child processes (bgrun.exit = stopped)
#                                           Use this, not a manual kill: kill <pid> stops only the wrapper.
#   bgrun.sh wait   <dir> [--max 20m] [--every 2m]
#                                           block until the run ends or --max is reached, print progress
#                                           exit 0 = finished (see <dir>/bgrun.exit), 3 = still running
#   bgrun.sh status <dir>                   print one status line and return at once
#
# Progress = rows in <dir>/**/*.jsonl (for example, one row per finished trial of a test harness)
# and the last 3 lines of the newest *.log under <dir>.
set -u

die() { echo "bgrun: $*" >&2; exit 2; }
secs() {  # 90 | 90s | 5m | 1h -> seconds
  local v=$1
  case $v in
    *h) echo $(( ${v%h} * 3600 )) ;;
    *m) echo $(( ${v%m} * 60 )) ;;
    *s) echo "${v%s}" ;;
    *)  echo "$v" ;;
  esac
}
alive() { [ -f "$1/bgrun.pid" ] && kill -0 "$(cat "$1/bgrun.pid")" 2>/dev/null; }
rows() { find "$1" -name '*.jsonl' -type f -exec cat {} + 2>/dev/null | grep -c . ; }
newest_log() { ls -t $(find "$1" -name '*.log' -type f 2>/dev/null) 2>/dev/null | head -n 1; }
elapsed() {
  local t0; t0=$(cat "$1/bgrun.start" 2>/dev/null || date +%s)
  local s=$(( $(date +%s) - t0 ))
  printf '%dh%02dm' $(( s / 3600 )) $(( s % 3600 / 60 ))
}
# Stop a process and all its children. A plain kill stops only the nohup wrapper and leaves the child running.
# Git Bash: fork does not keep the Windows parent link, so taskkill /T misses the children. Walk the ps tree.
pstab() {  # lines: pid ppid winpid (winpid empty on Linux)
  if ps -e -o pid=,ppid= >/dev/null 2>&1; then ps -e -o pid=,ppid=
  else ps -e | awk 'NR>1 { if ($1 !~ /^[0-9]+$/) $1=""; $0=$0; print $1, $2, $4 }'; fi
}
descendants() {  # print the pid and all its descendants: "pid winpid", parents first
  local tab; tab=$(pstab)
  echo "$tab" | awk -v root="$1" '{ par[$1]=$2; w[$1]=$3; n[NR]=$1 }
    END { want[root]=1; print root, w[root]; do { more=0; for (i in n) { p=n[i]
      if (!(p in want) && (par[p] in want)) { want[p]=1; print p, w[p]; more=1 } } } while (more) }'
}
kill_tree() {
  local pid=$1 list p wp i left
  list=$(descendants "$pid")  # collect first: after the parent dies, the children lose their ppid
  while read -r p wp; do kill "$p" 2>/dev/null; done <<< "$list"
  for i in 1 2 3 4 5; do
    left=0; while read -r p wp; do kill -0 "$p" 2>/dev/null && left=1; done <<< "$list"
    [ "$left" = 0 ] && return 0; sleep 1
  done
  while read -r p wp; do
    kill -0 "$p" 2>/dev/null || continue
    kill -9 "$p" 2>/dev/null
    [ -n "$wp" ] && command -v taskkill >/dev/null 2>&1 && taskkill //F //PID "$wp" >/dev/null 2>&1
  done <<< "$list"
  sleep 1
  left=0; while read -r p wp; do kill -0 "$p" 2>/dev/null && left=1; done <<< "$list"
  [ "$left" = 0 ]
}
stop_run() {
  local d=$1 pid; pid=$(cat "$d/bgrun.pid")
  echo "stopping old run pid $pid in $d"
  kill_tree "$pid" || die "could not stop pid $pid"
  echo stopped > "$d/bgrun.exit"
}
line() {
  local d=$1 st
  if alive "$d"; then st=running; else st="finished exit=$(cat "$d/bgrun.exit" 2>/dev/null || echo '?')"; fi
  echo "[$(date +%H:%M)] $st elapsed=$(elapsed "$d") jsonl_rows=$(rows "$d")"
}
show_tail() {
  local f; f=$(newest_log "$1")
  [ -n "$f" ] && { echo "  -- tail $f"; tail -n 3 "$f" | sed 's/^/  /'; }
}

cmd=${1:-}; dir=${2:-}
[ -n "$cmd" ] && [ -n "$dir" ] || die "usage: bgrun.sh start|wait|status|stop <dir> ..."
shift 2

case $cmd in
  start)
    replace=0
    [ "${1:-}" = "--replace" ] && { replace=1; shift; }
    [ "${1:-}" = "--" ] && shift
    [ $# -gt 0 ] || die "start needs a command after --"
    mkdir -p "$dir"
    if alive "$dir"; then
      [ "$replace" = 1 ] || die "a run is already active in $dir (pid $(cat "$dir/bgrun.pid")); add --replace to stop it first, or run: bgrun.sh stop $dir"
      stop_run "$dir"
    fi
    rm -f "$dir/bgrun.exit"
    date +%s > "$dir/bgrun.start"
    printf '%q ' "$@" > "$dir/bgrun.cmd"; echo >> "$dir/bgrun.cmd"
    # The subshell records the exit code of the command when it ends.
    nohup bash -c '"$@"; echo $? > "'"$dir"'/bgrun.exit"' bgrun "$@" > "$dir/bgrun.log" 2>&1 &
    echo $! > "$dir/bgrun.pid"
    echo "started pid $(cat "$dir/bgrun.pid"), log $dir/bgrun.log"
    sleep "${BGRUN_FIRST_CHECK:-60}"
    if command -v powershell >/dev/null 2>&1; then
      echo "cpu% $(powershell -NoProfile -c '[int](Get-Counter "\Processor(_Total)\% Processor Time").CounterSamples.CookedValue' 2>/dev/null | tr -d '\r')"
    fi
    line "$dir"
    echo "  -- head $dir/bgrun.log"; head -n 5 "$dir/bgrun.log" | sed 's/^/  /'
    show_tail "$dir"
    ;;
  wait)
    max=1200; every=120
    while [ $# -gt 0 ]; do
      case $1 in
        --max) max=$(secs "$2"); shift 2 ;;
        --every) every=$(secs "$2"); shift 2 ;;
        *) die "unknown option $1" ;;
      esac
    done
    [ -f "$dir/bgrun.pid" ] || die "no run in $dir"
    end=$(( $(date +%s) + max ))
    while alive "$dir"; do
      now=$(date +%s)
      [ "$now" -ge "$end" ] && { line "$dir"; show_tail "$dir"; echo "still running: call wait again"; exit 3; }
      step=$every; [ $(( end - now )) -lt "$step" ] && step=$(( end - now ))
      sleep "$step"
      alive "$dir" && line "$dir"
    done
    line "$dir"; show_tail "$dir"
    exit 0
    ;;
  stop)
    alive "$dir" || { echo "no active run in $dir"; exit 0; }
    stop_run "$dir"
    ;;
  status)
    line "$dir"; show_tail "$dir"
    alive "$dir" && exit 3 || exit 0
    ;;
  *) die "unknown command $cmd" ;;
esac
