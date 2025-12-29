# RR V3 Debugger MVP - Manual Acceptance Checklist

This checklist validates the RR V3 Debugger MVP end-to-end (Sidepanel ↔ Background) with reproducible, manual steps.

## Test Run Info

| Field             | Value |
| ----------------- | ----- |
| Date              |       |
| Tester            |       |
| OS                |       |
| Chrome version    |       |
| Extension version |       |
| Notes             |       |

## Scope

**In scope:**

- Background: `DebugController` (attach/detach, pause/resume/stepOver, breakpoints, getVar/setVar)
- Background: `RpcServer` routing (`rr_v3.debug`, `rr_v3.subscribe`, etc.)
- Sidepanel: `useRRV3Rpc` (Port-RPC client), `useRRV3Debugger` (state/commands), `DebuggerPanel.vue` (UI MVP)

**Out of scope (Phase 3+):**

- Run Queue / multi-run scheduling
- Breakpoint editing UI (MVP is display-only)
- Stepping modes beyond `stepOver`

---

## Prerequisites / Setup

### Build & Load Extension

- [ ] Build the extension

  ```bash
  pnpm dev:extension
  # or: pnpm --filter chrome-mcp-server dev
  ```

- [ ] Load in Chrome
  1. Open `chrome://extensions/`
  2. Enable "Developer mode"
  3. Click "Load unpacked" → select `app/chrome-extension/.output/chrome-mv3-dev`

### Verify Background Services

- [ ] RR V3 background services are running
  - Port listener for `chrome.runtime.onConnect` with name `rr_v3`
  - `RpcServer` started with `DebugController` configured
  - `EventsBus` appends/broadcasts run events

  **Symptom if missing:** Port connects but requests timeout (`RPC timeout ...`)

### Access DebuggerPanel

- [ ] `DebuggerPanel.vue` is accessible with a `runId`
  - Location: `app/chrome-extension/entrypoints/sidepanel/components/rr-v3/DebuggerPanel.vue`
  - If not wired into navigation, temporarily mount for QA

### Prepare Test Data

- [ ] Have at least one RR V3 `runId` available
  - For attach/detach/breakpoints: run must exist in `rr_v3.runs` store
  - For pause/resume/stepOver: run must have an active `RunRunner`

---

## Observability

| Tool                | Access                                                          |
| ------------------- | --------------------------------------------------------------- |
| Sidepanel DevTools  | Right-click inside sidepanel → Inspect                          |
| Background DevTools | `chrome://extensions/` → Extension → "Service worker" → Inspect |
| IndexedDB           | DevTools → Application → IndexedDB → `rr_v3`                    |

**IndexedDB Stores:**

- `flows` - Flow definitions
- `runs` - Run records
- `events` - Run events (chunked)
- `queue` - Run queue
- `persistent_vars` - $ variables
- `triggers` - Trigger definitions

---

## Helper: Port-RPC Console Snippets

Paste these in Sidepanel DevTools for manual testing:

```javascript
// Open a Port connection
function rrv3OpenPort() {
  const port = chrome.runtime.connect({ name: 'rr_v3' });
  port.onMessage.addListener((msg) => console.log('[rr_v3]', msg));
  port.onDisconnect.addListener(() =>
    console.warn('[rr_v3] disconnected', chrome.runtime.lastError?.message),
  );
  return port;
}

// Send RPC request
function rrv3Request(port, method, params, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const req = { type: 'rr_v3.request', requestId, method, params };

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      port.onMessage.removeListener(onMsg);
      if (timer) clearTimeout(timer);
    };

    const onMsg = (msg) => {
      if (msg?.type !== 'rr_v3.response' || msg.requestId !== requestId) return;
      if (settled) return;
      settled = true;
      cleanup();
      msg.ok ? resolve(msg.result) : reject(new Error(msg.error || 'RPC error'));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Timeout (${timeoutMs}ms): ${method}`));
    }, timeoutMs);

    port.onMessage.addListener(onMsg);
    port.postMessage(req);
  });
}

// Quick smoke test
async function rrv3Smoke() {
  const port = rrv3OpenPort();
  const runs = await rrv3Request(port, 'rr_v3.listRuns', {});
  console.log('Runs:', runs);
  return port;
}
```

---

## Checklist

### 1. Transport / Port-RPC

| ID  | Test                                                           | Status |
| --- | -------------------------------------------------------------- | ------ |
| T1  | **Can connect and receive responses**                          | [ ]    |
|     | 1. Open Sidepanel DevTools                                     |
|     | 2. Run `const port = rrv3OpenPort();`                          |
|     | 3. Run `await rrv3Request(port, 'rr_v3.listRuns', {});`        |
|     | **Expected:** Response within 12s, `ok: true`, result is array |

| T2 | **Subscription gates event broadcast** | [ ] |
| | 1. `await rrv3Request(port, 'rr_v3.subscribe', { runId: '<RUN_ID>' });` |
| | 2. Wait for run events (node.started, run.paused, etc.) |
| | 3. `await rrv3Request(port, 'rr_v3.unsubscribe', { runId: '<RUN_ID>' });` |
| | **Expected:** Events arrive while subscribed, stop after unsubscribe |

### 2. DebuggerPanel UI Smoke

| ID  | Test                                                                               | Status |
| --- | ---------------------------------------------------------------------------------- | ------ |
| U1  | **Connection status renders correctly**                                            | [ ]    |
|     | Open DebuggerPanel and observe header status                                       |
|     | **Expected:** Shows "Connecting…", "Connected", "Reconnecting…", or "Disconnected" |
|     | **Expected:** Reconnect button disabled while connecting                           |

| U2 | **State fields render safely** | [ ] |
| | **Expected:** runId, status, execution, currentNodeId, pauseReason render |
| | **Expected:** pauseReason is human-readable (not `[object Object]`) |
| | **Expected:** No console errors |

### 3. Attach / Detach

| ID  | Test                                            | Status |
| --- | ----------------------------------------------- | ------ |
| A1  | **Attach succeeds for existing run**            | [ ]    |
|     | Precondition: `<RUN_ID>` exists in `rr_v3.runs` |
|     | 1. Open DebuggerPanel with runId                |
|     | 2. Click "Attach"                               |
|     | **Expected:** status = `attached`, no error     |

| A2 | **Attach fails for missing run** | [ ] |
| | Use `missing-run-<timestamp>` (non-existent) |
| | Click "Attach" |
| | **Expected:** Error: `Run "<RUN_ID>" not found` |

| A3 | **Detach works** | [ ] |
| | While attached, click "Detach" |
| | **Expected:** status = `detached` |
| | **Expected:** Auto-refresh stops |

### 4. Pause / Resume (Requires Active Runner)

| ID  | Test                                       | Status |
| --- | ------------------------------------------ | ------ |
| P1  | **Pause changes execution to paused**      | [ ]    |
|     | Precondition: Run is actively executing    |
|     | 1. Attach to run                           |
|     | 2. Click "Pause"                           |
|     | **Expected:** execution = `paused`         |
|     | **Expected:** pauseReason = "Manual pause" |
|     | **Expected:** `run.paused` event in store  |

| P2 | **Resume changes execution to running** | [ ] |
| | Click "Resume" |
| | **Expected:** execution = `running` |
| | **Expected:** `run.resumed` event in store |

| P3 | **Pause/Resume errors on inactive run** | [ ] |
| | Precondition: Run exists but no active runner |
| | Click "Pause" |
| | **Expected:** Error: `Runner for "<RUN_ID>" not found` |

### 5. Step Over (Requires Paused State + Active Runner)

| ID  | Test                                                | Status |
| --- | --------------------------------------------------- | ------ |
| S1  | **Step Over pauses at next node**                   | [ ]    |
|     | Precondition: Run paused, flow has subsequent nodes |
|     | Click "Step Over"                                   |
|     | **Expected:** Resumes briefly, pauses again         |
|     | **Expected:** pauseReason = "Step at <NODE_ID>"     |
|     | **Expected:** currentNodeId updates                 |

### 6. Breakpoints (MVP: Display-Only UI)

| ID  | Test                                                    | Status |
| --- | ------------------------------------------------------- | ------ |
| B1  | **Breakpoints list renders**                            | [ ]    |
|     | Precondition: Run has breakpoints set                   |
|     | Attach to run                                           |
|     | **Expected:** Breakpoints section shows "N total"       |
|     | **Expected:** Each item shows nodeId and enabled status |

| B2 | **Set breakpoints via RPC** | [ ] |
| | `javascript |
| | await rrv3Request(port, 'rr_v3.debug', { |
| |   type: 'debug.setBreakpoints', |
| |   runId: '<RUN_ID>', |
| |   nodeIds: ['A', 'B'] |
| | }); |
| | ` |
| | **Expected:** `ok: true`, breakpoints include A and B |

| B3 | **Breakpoint hit pauses run** | [ ] |
| | Precondition: Active runner + breakpoint on reachable node |
| | Wait for run to reach breakpoint |
| | **Expected:** Pauses with "Breakpoint at <NODE_ID>" |
| | **Expected:** `run.paused` event has `reason.kind === 'breakpoint'` |

| B4 | **Breakpoints persist across reattach** | [ ] |
| | 1. Set breakpoints |
| | 2. Detach, then attach again |
| | **Expected:** Breakpoints still present |

| B5 | **Breakpoints persist after SW restart** | [ ] |
| | 1. Set breakpoints |
| | 2. Terminate Service Worker |
| | 3. Wait for restart, attach again |
| | **Expected:** Breakpoints restored from `rr_v3.runs.debug.breakpoints` |

### 7. Variables (Console-Only in MVP)

| ID  | Test                                                 | Status |
| --- | ---------------------------------------------------- | ------ |
| V1  | **getVar returns value**                             | [ ]    |
|     | ```javascript                                        |
|     | await rrv3Request(port, 'rr_v3.debug', {             |
|     | type: 'debug.getVar',                                |
|     | runId: '<RUN_ID>',                                   |
|     | name: 'foo'                                          |
|     | });                                                  |
|     | ```                                                  |
|     | **Expected:** `ok: true`, value returned (or `null`) |

| V2 | **setVar updates variable** | [ ] |
| | Precondition: Active runner |
| | 1. Set: `{ type: 'debug.setVar', runId, name: 'foo', value: 123 }` |
| | 2. Get: `{ type: 'debug.getVar', runId, name: 'foo' }` |
| | **Expected:** Returns `123` |

| V3 | **setVar fails for inactive run** | [ ] |
| | Precondition: Run exists but no runner |
| | **Expected:** Error: `Runner for "<RUN_ID>" not found - cannot set variable on inactive run` |

### 8. Reconnect / Resilience

| ID  | Test                                                                 | Status |
| --- | -------------------------------------------------------------------- | ------ |
| R1  | **Auto-reconnect after SW termination**                              | [ ]    |
|     | 1. Keep DebuggerPanel open                                           |
|     | 2. `chrome://extensions/` → Extension → Service worker → "Terminate" |
|     | 3. Observe connection state                                          |
|     | **Expected:** Shows "Reconnecting…" then "Connected"                 |
|     | **Expected:** Subsequent RPC succeeds                                |

| R2 | **Subscription restored after reconnect** | [ ] |
| | Precondition: Run producing events |
| | 1. Attach and verify currentNodeId updates |
| | 2. Terminate SW |
| | 3. Wait for reconnect |
| | **Expected:** currentNodeId continues updating |

### 9. Error / Edge Cases

| ID  | Test                                                  | Status |
| --- | ----------------------------------------------------- | ------ |
| E1  | **DebugController not configured**                    | [ ]    |
|     | Precondition: RpcServer without DebugController       |
|     | Call `rr_v3.debug`                                    |
|     | **Expected:** Error: `DebugController not configured` |

| E2 | **Invalid debug command payload** | [ ] |
| | `await rrv3Request(port, 'rr_v3.debug', { runId: '<ID>' });` |
| | **Expected:** Error: `Invalid debug command` |

| E3 | **Multiple sidepanels attach concurrently** | [ ] |
| | Open sidepanel in two Chrome windows |
| | Attach both to same run |
| | **Expected:** No crashes or disconnect loops |
| | **Note:** State sync across panels not guaranteed in MVP |

---

## Cleanup

- [ ] **Reset RR V3 data**
  1. DevTools → Application → IndexedDB → `rr_v3`
  2. Right-click → Delete database

  **Result:** All RR V3 data cleared for clean re-test

---

## Sign-off

| Role     | Name | Date | Signature |
| -------- | ---- | ---- | --------- |
| Tester   |      |      |           |
| Reviewer |      |      |           |

---

_Last updated: 2025-12-27_
