"""Find past pi sessions: rank them by keywords and date, and show prompts, status and the git state of the worktree.

    python search.py release docker               # last 30 days, best matches first
    python search.py changelog --day 2026-10-15   # only sessions active on that day (local time)
    python search.py --since 2 --unfinished       # no keywords: newest first
    python search.py "eval(s)?" --regex --limit 5 --json

Keywords are case-insensitive. A keyword without any match is reported with close words from the user prompts
(for example "changelogs" -> "changelog"), and the closest one is searched too. Paths are never passed through a
shell, so session folders that start with "-" are no problem.
"""
import argparse, datetime as dt, difflib, json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(os.environ.get("PI_SESSIONS_DIR", Path.home() / ".pi" / "agent" / "sessions"))
USER_WEIGHT = 5  # a keyword in your own prompt says more than one in tool output
MAX_HITS = 200   # tool output can repeat a word thousands of times


def text_of(content):
    if isinstance(content, str):
        return content
    return " ".join(c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text")


def parse(path):
    """Header, user prompts with times, the last assistant stop reason, and the raw text."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    info = dict(path=str(path), id=None, cwd=None, start=None, end=None, prompts=[], stop=None, raw=raw)
    for line in raw.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "session":
            info.update(id=e.get("id"), cwd=e.get("cwd"), start=e.get("timestamp"))
        if e.get("type") != "message":
            continue
        info["end"] = e.get("timestamp") or info["end"]
        m = e.get("message") or {}
        if m.get("role") == "user":
            t = " ".join(text_of(m.get("content")).split())
            if t:
                info["prompts"].append((e.get("timestamp"), t))
        elif m.get("role") == "assistant":
            info["stop"] = m.get("stopReason")
    if not info["id"]:  # older files: the id is the end of the file name
        info["id"] = path.stem.split("_")[-1]
    return info


def local(ts):
    try:
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone()
    except (AttributeError, ValueError):
        return None


def candidates(root, since):
    """Session files written since `since`: the last write is the last activity, so a session that started before
    still counts."""
    for f in root.glob("*/*.jsonl"):
        if f.stat().st_mtime >= since:
            yield f


def git_state(cwd):
    if not cwd or not Path(cwd).is_dir():
        return "folder gone"
    try:
        r = subprocess.run(["git", "-C", cwd, "status", "--porcelain=v1", "-b"], capture_output=True, text=True,
                           timeout=10, encoding="utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return "git did not answer"
    if r.returncode:
        return "not a git folder"
    lines = r.stdout.splitlines()
    head = lines[0][3:] if lines else "?"
    mod = sum(1 for l in lines[1:] if not l.startswith("??"))
    new = sum(1 for l in lines[1:] if l.startswith("??"))
    return f"{head}; {mod} changed, {new} untracked" if mod or new else f"{head}; clean"


def close_words(term, sessions):
    words = {}
    for s in sessions:
        for _, p in s["prompts"]:
            for w in re.findall(r"[a-zA-Z][\w-]{2,}", p.lower()):
                words[w] = words.get(w, 0) + 1
    return difflib.get_close_matches(term.lower(), list(words), n=3, cutoff=0.7)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("terms", nargs="*", help="keywords (any of them counts)")
    ap.add_argument("--since", type=float, default=30, help="days back (default 30)")
    ap.add_argument("--day", help="YYYY-MM-DD: only sessions active on that local day")
    ap.add_argument("--regex", action="store_true", help="the keywords are regular expressions")
    ap.add_argument("--unfinished", action="store_true", help="only sessions whose last reply did not end normally")
    ap.add_argument("--limit", type=int, default=8)
    ap.add_argument("--no-git", action="store_true", help="do not run git status")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):  # the Windows console code page cannot show all prompt characters
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    me = os.path.normcase(os.environ.get("PI_SESSION_FILE", ""))  # the session that runs this search matches itself

    now = dt.datetime.now().astimezone()
    day = dt.date.fromisoformat(a.day) if a.day else None
    since = (dt.datetime.combine(day, dt.time()).astimezone() if day else now - dt.timedelta(days=a.since)).timestamp()
    sessions = [parse(f) for f in candidates(ROOT, since) if os.path.normcase(str(f)) != me]
    if day:  # active on that day: it started on or before it, and its last message is on or after it
        sessions = [s for s in sessions if (local(s["start"]) or now).date() <= day <= (local(s["end"]) or now).date()]
    if a.unfinished:
        sessions = [s for s in sessions if s["stop"] != "stop"]

    terms, notes = list(a.terms), []
    pats = {t: re.compile(t if a.regex else re.escape(t), re.I) for t in terms}
    for t in a.terms:  # a keyword without any match: say so, and search the closest word too
        if not any(pats[t].search(s["raw"]) for s in sessions):
            near = close_words(t, sessions)
            notes.append(f"no match for '{t}'" + (f"; close words: {', '.join(near)} (searched '{near[0]}')" if near else ""))
            if near:
                pats[near[0]] = re.compile(re.escape(near[0]), re.I)

    rows = []
    for s in sessions:
        hits = {t: min(len(p.findall(s["raw"])), MAX_HITS) for t, p in pats.items()}
        in_prompts = sum(len(p.findall(" ".join(x for _, x in s["prompts"]))) for p in pats.values())
        score = sum(hits.values()) + USER_WEIGHT * in_prompts
        if pats and not score:
            continue
        rows.append(dict(score=score, hits={t: n for t, n in hits.items() if n}, s=s))
    rows.sort(key=lambda r: (-r["score"], -(local(r["s"]["end"]) or now).timestamp()) if pats
              else -(local(r["s"]["end"]) or now).timestamp())
    rows = rows[:a.limit]

    out = []
    for r in rows:
        s = r["s"]
        out.append(dict(id=s["id"], path=s["path"], cwd=s["cwd"], start=s["start"], end=s["end"], prompts=len(s["prompts"]),
                        finished=s["stop"] == "stop", score=r["score"], hits=r["hits"],
                        first_prompt=s["prompts"][0][1][:300] if s["prompts"] else "",
                        last_prompt=s["prompts"][-1][1][:300] if len(s["prompts"]) > 1 else "",
                        git=None if a.no_git else git_state(s["cwd"]), resume=f"pi --session {s['id']}"))
    if a.json:
        print(json.dumps(dict(notes=notes, sessions=out), indent=1, ensure_ascii=False))
        return 0
    for n in notes:
        print(f"NOTE: {n}")
    print(f"{len(out)} of {len(sessions)} sessions in {ROOT}" + (f" active on {day}" if day else f", last {a.since:g} days"))
    for i, o in enumerate(out, 1):
        st, en = local(o["start"]), local(o["end"])
        when = f"{st:%Y-%m-%d %H:%M}" if st else "?"
        when += f" -> {en:%Y-%m-%d %H:%M}" if en and st and en.date() != st.date() else (f"-{en:%H:%M}" if en else "")
        hits = ", ".join(f"{t}:{n}" for t, n in o["hits"].items())
        print(f"\n{i}. {when}  {'done' if o['finished'] else 'UNFINISHED'}  {o['prompts']} prompt{'s' if o['prompts'] != 1 else ''}  {hits}")
        print(f"   folder: {o['cwd']}" + (f"  [{o['git']}]" if o["git"] else ""))
        print(f"   first:  {o['first_prompt'][:160]}")
        if o["last_prompt"]:
            print(f"   last:   {o['last_prompt'][:160]}")
        print(f"   resume: {o['resume']}\n   file:   {o['path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
