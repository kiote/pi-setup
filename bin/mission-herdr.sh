#!/usr/bin/env bash
# mission-herdr.sh - start a pi-mission-mode mission in a new herdr tab, so that herdr shows it.
#
#   mission-herdr.sh <worktree> <mission-file> [--label TEXT] [--timeout-ms N]
#
#   <worktree>      the folder that holds the mission (the cwd of pi; pi makes no new worktree: PI_NO_WORKTREE=1)
#   <mission-file>  path relative to <worktree>, for example .pi/<slug>/mission.json
#
# The tab goes to the herdr workspace with the repo name (<repo> of <repo>-wt-<x>), or to a new workspace.
# pi starts with "/mission start --yes <mission-file>". Prints "OK <pane> <agent>" or "FAIL <reason>". Exit 0 = ok.
# Do not start missions in a separate Windows Terminal window: herdr does not see that window.
set -u

usage() { sed -n '2,12p' "$0" >&2; exit 2; }
fail() { echo "FAIL $*" >&2; exit 1; }
[ $# -ge 2 ] || usage
WT=$(cygpath -m "$1"); FILE=$2; shift 2
LABEL=""; TIMEOUT=120000
while [ $# -gt 0 ]; do
  case $1 in --label) LABEL=${2:-}; shift 2;; --timeout-ms) TIMEOUT=${2:-}; shift 2;; *) usage;; esac
done
[ -d "$WT" ] || fail "no folder $WT"
[ -f "$WT/$FILE" ] || fail "no mission file $WT/$FILE"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$WT/$FILE" || fail "mission file is not JSON"
SLUG=$(basename "$(dirname "$FILE")")
[ -n "$LABEL" ] || LABEL="mission: $SLUG"

NAME=$(basename "$WT"); PARENT=$(dirname "$WT"); REPO=${NAME%%-wt-*}
[ "$REPO" != "$NAME" ] && [ -d "$PARENT/$REPO" ] || REPO=$NAME
WIN_WT=$(cygpath -w "$WT")

jq_node() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.error){console.error(j.error.code+': '+j.error.message);process.exit(1)}const r=j.result;$1})" "${@:2}"; }

WS=$(herdr workspace list 2>&1 | jq_node "const w=r.workspaces.find(w=>(w.label||'').toLowerCase()===process.argv[1].toLowerCase());console.log(w?w.workspace_id:'')" "$REPO") \
  || fail "herdr workspace list: $WS"
if [ -n "$WS" ]; then
  PANE=$(herdr tab create --workspace "$WS" --cwd "$WIN_WT" --label "$LABEL" --env PI_NO_WORKTREE=1 2>&1 \
    | jq_node "console.log(r.root_pane.pane_id)") || fail "herdr tab create: $PANE"
else
  OUT=$(herdr workspace create --cwd "$WIN_WT" --label "$REPO" --env PI_NO_WORKTREE=1 --no-focus 2>&1) || fail "herdr workspace create: $OUT"
  PANE=$(echo "$OUT" | jq_node "console.log(r.root_pane.pane_id)") || fail "herdr workspace create: $OUT"
  TAB=$(echo "$OUT" | jq_node "console.log(r.root_pane.tab_id)")
  herdr tab rename "$TAB" "$LABEL" >/dev/null 2>&1 || true
fi

# herdr cannot pass arguments to the `pi` PowerShell function, so start pi without them and send the command as a prompt.
AGENT="mission-$SLUG-$(date +%s)"
OUT=$(herdr agent start "$AGENT" --kind pi --pane "$PANE" --timeout "$TIMEOUT" 2>&1) \
  || fail "herdr agent start in $PANE: $OUT"
echo "$OUT" | jq_node "" >/dev/null 2>&1 || fail "herdr agent start in $PANE: $OUT"
# MSYS_NO_PATHCONV: Git Bash would turn "/mission ..." into a Windows path.
CMD="/mission start --yes $FILE"
OUT=$(MSYS_NO_PATHCONV=1 herdr agent prompt "$AGENT" "$CMD" --wait --until working --until blocked --until done \
  --until idle --timeout 20000 2>&1)
if echo "$OUT" | grep -q '"error"'; then
  # While pi still starts, the Enter of a prompt can be lost (agent_prompt_stalled); a second Enter submits it.
  echo "$OUT" | grep -qE 'agent_prompt_stalled|"timeout"' || fail "herdr agent prompt: $OUT"
  herdr agent send-keys "$AGENT" enter >/dev/null 2>&1 || fail "herdr agent send-keys: $OUT"
fi
sleep 3
echo "--- pane $PANE (last lines)"
herdr pane read "$PANE" --lines 8 --source recent 2>/dev/null | tail -n 8
echo "OK $PANE $AGENT ($REPO, $WIN_WT)"
