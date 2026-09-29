# Troubleshooting & Recovery Runbooks

This guide provides diagnostic procedures and recovery recipes for failures in `lazypi`, local gateways, subagent processes, and UI synchronization.

---

## 1. Quick Triage Checklist

When models fail to load, commands fail, or subagents freeze, run this diagnostic sequence:

```bash
# 1. Inspect status of all core services
sdm ls

# 2. Test local gateway connectivity
curl -s -m 2 http://127.0.0.1:4010/v1/models | head -c 100 # NexusRoute
curl -s -m 2 http://127.0.0.1:4000/v1/models | head -c 100 # OMP Gateway
curl -s -m 2 http://127.0.0.1:9999/api/pi/runtime          # PiChamber Server

# 3. Test Pi provider registration
pi --list-models nexus

# 4. Check for orphaned subagent child processes
pgrep -fl "pi --mode json"
```

---

## 2. Zombie / Orphaned Subagent Process Cleanup

### Problem
Because subagents are spawned as separate CLI child processes (`pi --mode json -p --no-session`), an abrupt termination of PiChamber (e.g. browser tab closed, network glitch, or daemon crash) can leave detached `pi` child processes running in the background, consuming CPU and memory.

### Detection
```bash
ps aux | grep "pi --mode json" | grep -v grep
```

### Remediation
```bash
# Graceful termination (SIGTERM)
pkill -f "pi --mode json"

# Forceful kill if processes remain stuck
pkill -9 -f "pi --mode json"

# Verify all child processes are cleared
pgrep -fl "pi --mode json" || echo "All subagent processes cleared."
```

---

## 3. Stale Gateway Snapshot Invalidation

### Problem
`omp-provider.ts` caches the list of models returned by NexusRoute/OMP Gateway to:
`~/.cache/pichamber/nexus-models-snapshot.json`

If the gateway is reconfigured, or new models are added to the upstream provider while the gateways are stopped, Pi will continue to serve the stale snapshot.

### Remediation
```bash
# 1. Remove the cached snapshot
rm -f ~/.cache/pichamber/nexus-models-snapshot.json
rm -f ~/.cache/pichamber/nexus-models.json 2>/dev/null

# 2. Ensure gateways are running
sdm r nexus-gateway || sdm r omp-gateway

# 3. Force Pi to re-probe and recreate the cache
pi -e ~/projects/lazypi/extensions/omp-provider.ts --list-models nexus

# 4. Verify new snapshot was created
ls -lh ~/.cache/pichamber/nexus-models-snapshot.json
```

---

## 4. The NPM "pi" Namespace Collision Trap

### Post-Mortem & Root Cause
In npm, the identifier `pi` is claimed by an obsolete math library (`pi@2.0.5` / `pi-decimals`) intended to compute digits of $\pi$.
If a developer or script runs:
```bash
bun add pi       # OR npm install pi
```
in the home directory `~`, Bun creates a binary symlink:
`~/.bun/bin/pi -> ../../node_modules/pi/bin/pi`

This overwrites the real Pi Coding Agent CLI binary (`@earendil-works/pi-coding-agent`), resulting in a fatal loader crash:
```text
node:internal/modules/cjs/loader:1520
  throw err;
  ^
Error: Cannot find module './pi'
Require stack:
- /home/shobixlinuxdev/node_modules/pi-decimals/lib/index.js
```

### Remediation & Recovery
```bash
# 1. Remove the math package from ~/package.json
cd ~ && bun remove pi

# 2. Re-link ~/.bun/bin/pi to the real Pi coding agent bundle
ln -sf ../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js /home/shobixlinuxdev/.bun/bin/pi
chmod +x /home/shobixlinuxdev/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js

# 3. Verify real CLI runs
pi --version
pi --help
```

---

## 5. PiChamber WebSocket Disconnects & Long Tasks

### Problem
PiChamber's daemon runs a 5-minute idle reaper after `agent_settled`. Additionally, browser clients on mobile or unreliable networks (e.g. Tailscale) may drop their WebSocket connection during long subagent runs.

### Symptoms
- WebUI appears frozen or displays a disconnected banner.
- On browser refresh, subagent progress widgets disappear.

### Recovery
1. **Server-Side State Preservation**: PiChamber's `extension-bridge.js` retains normalized extension statuses and widgets per session. Re-opening the session restores the last recorded status.
2. **Checking Backend Activity**:
   Verify if the subagent is still working on the machine even if the UI disconnected:
   ```bash
   sdm l pichamber
   ps aux | grep "pi --mode json"
   ```
3. **If Session Daemon Stuck**:
   Restart the PiChamber service:
   ```bash
   sdm r pichamber
   ```
   *(Note: This restarts the web UI server; session files on disk remain safe in `~/.pi/agent/sessions/`).*

---

## 6. Corrupted Agent Frontmatter

### Problem
When creating custom agents in `~/.pi/agent/agents/*.md` or `.pi/agents/*.md`, invalid YAML or malformed `tools` entries can cause discovery issues.

### Normalization Rules
`extensions/subagent/agents.ts` accommodates two valid tool formats:
```yaml
# Format A: Comma-separated string
tools: read, bash, edit, write

# Format B: YAML array
tools:
  - read
  - bash
  - edit
  - write
```
Any other format (e.g. nested objects or numbers) will be ignored and yield an empty toolset rather than throwing an exception.
