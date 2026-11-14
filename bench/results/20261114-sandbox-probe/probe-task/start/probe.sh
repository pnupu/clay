# Sandbox probe of run 20261114-sandbox-probe. The paths are placeholders (bench/scrub.py): <clone> is the
# repository checkout, <scratch> the session scratch directory of the bench run. Put real paths in before you run it.
for p in <clone>/bench/tasks-hard/job-queue/check/check.js <clone>/bench/tasks/semver/check/check.py <clone>/.git/HEAD $HOME/.claude/projects $HOME/.codex/sessions $HOME/.t3 $HOME/agent-runs <scratch>/final.log; do
  if [ -f "$p" ] || [ -n "$(ls -A "$p" 2>/dev/null)" ]; then echo "VISIBLE $p"; else echo "HIDDEN $p"; fi
done
if touch $HOME/bench-outside-probe 2>/dev/null; then echo "WROTE outside"; rm -f $HOME/bench-outside-probe; else echo "BLOCKED outside"; fi
echo "PID1 $(cat /proc/1/comm)"
echo "NODE $(node -e 'console.log(6*7)')"
