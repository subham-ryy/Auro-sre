# AutoSRE — Agent Architecture

> **Runtime models:** Groq (prod) · Ollama (dev/local)  
> **Frontend:** Next.js → Vercel  
> **Product analytics:** Novus.ai (mandatory sponsor — installed on frontend, connected via GitHub)  
> **Agent backend:** Node.js → Render  
> **Target app:** Express + PostgreSQL → Railway + Supabase

---

## The Society of Three Agents

```
┌─────────────────────────────────────────────────────────┐
│                     INCIDENT EVENT                      │
│         (Target App /health fails or DB errors)        │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  THE DETECTIVE  │  ← searches live logs via MCP
              │  (Data Gatherer)│    (search_logs / grep_errors)
              └────────┬────────┘
                       │ proposes root cause
                       ▼
              ┌─────────────────┐
              │   THE FIXER     │  ← writes patch / SQL / script
              │   (Engineer)    │    executes against live Supabase
              └────────┬────────┘
                       │ proposes fix
                       ▼
              ┌─────────────────┐
              │  THE SKEPTIC    │  ← APPROVES or REJECTS
              │  (Gatekeeper)   │    Llama 3 70B — pure reasoning
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │                 │
           REJECTED          APPROVED
              │                 │
              └──► loop back    └──► deploy fix to live DB
                  to Detective       + close incident
```

---

## Deployment Architecture

```
JUDGES' BROWSER
      │
      ▼
┌──────────────────┐        ┌──────────────────────┐
│  Next.js UI      │        │   TARGET APP          │
│  on Vercel       │◄──────►│   Express + Postgres  │
│                  │        │   on Railway          │
│  - Live app      │        │   /health endpoint    │
│    status        │        │   /break  endpoint ◄──┼── seeds bad data
│  - Agent         │        │   connected to        │    for demo
│    terminal      │        │   Supabase DB         │
│  - Novus.ai      │        └──────────────────────┘
│    instrumented  │
│    (behaviors    │
│    trackable)    │
└──────┬───────────┘
       │
       ▼
┌─────────────┐
│ Agent Backend│
│ on Render   │
│             │
│ orchestrator│
│ + MCP server│
│             │
│ calls Groq  │
│ (prod) or   │
│ Ollama(dev) │
└─────────────┘
```

**Flow:** Judge hits Vercel link → sees Target App crashed → clicks "Trigger AutoSRE" → agent backend spins up → agents talk to Groq → Fixer executes SQL on Supabase → Target App recovers → UI shows resolved.

---

## Model Routing — Dev vs Prod

```javascript
// orchestrator.js — Open-Weights Model Router
const ENV = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';

// Prod: Groq for lightning-fast inference (real-time agent debate)
// Dev: Ollama locally (free, no API limits while building)
const CONFIG = {
  skeptic:   ENV === 'prod' ? 'llama3-70b-8192' : 'llama3',   // Heaviest — pure reasoning
  detective: ENV === 'prod' ? 'llama3-8b-8192'  : 'mistral',  // Fast — log searching
  fixer:     ENV === 'prod' ? 'llama3-8b-8192'  : 'mistral',  // Fast — code generation
};

// Why Skeptic gets 70B:
// The Skeptic does no tool calls — it reads two text blobs and reasons.
// 70B is overkill for log parsing but exactly right for "is this fix correct?"
// Judges notice when you assign model size deliberately. Mention it in the demo.
```

**Why this matters for judges:** Assigning the 70B model to the reasoning-only agent (Skeptic) and 8B to the tool-calling agents (Detective, Fixer) shows deliberate architectural thinking, not just "plug in one model everywhere."

---

## Optimisation 1 — Dynamic Memory (Rolling Thread History)

Without this, the loop is broken by design. When the Skeptic rejects, the Fixer has no idea why and will regenerate the exact same SQL. This is not a polish item — it's a correctness requirement.

**How it works:** The orchestrator maintains a single `incidentThread` array for the entire lifecycle of one incident. Every agent turn — Detective findings, Fixer proposals, Skeptic verdicts — gets appended. Each agent call receives the full thread as context, not just the last message.

```javascript
// orchestrator.js

const incidentThread = []; // lives for one incident lifecycle, cleared on CLOSED

function appendToThread(role, content) {
  incidentThread.push({ role, content, timestamp: Date.now() });
}

async function runDetective() {
  const response = await callAgent(CONFIG.detective, DETECTIVE_SYSTEM_PROMPT, [
    ...incidentThread,                          // full history so far
    { role: 'user', content: 'Search logs and report your findings.' }
  ]);
  appendToThread('detective', response);
  return response;
}

async function runFixer(detectiveFindings) {
  const response = await callAgent(CONFIG.fixer, FIXER_SYSTEM_PROMPT, [
    ...incidentThread,   // Fixer sees ALL prior rejections and why they failed
    { role: 'user', content: `Root cause identified: ${detectiveFindings}. Propose a fix.` }
  ]);
  appendToThread('fixer', response);
  return response;
}

async function runSkeptic(detectiveFindings, fixerProposal) {
  const response = await callAgent(CONFIG.skeptic, SKEPTIC_SYSTEM_PROMPT, [
    ...incidentThread,
    { role: 'user', content: `Detective says: ${detectiveFindings}\nFixer proposes: ${JSON.stringify(fixerProposal)}\nVerdict?` }
  ]);
  appendToThread('skeptic', response);
  return response;
}
```

**What this unlocks in practice:**
- Round 2 Fixer can see "REJECTED — scaling doesn't fix a bad query" and won't propose scaling again
- Skeptic can reference its own prior rejections: "I already rejected a pool size change in round 1"
- The terminal output in the UI shows a coherent argument with memory, not disconnected takes

**Context window budget per agent call (8k limit):**
```
System prompt:         ~500 tokens
Thread history:        ~300 tokens per round × max 3 rounds = ~900 tokens
Current user message:  ~200 tokens
留 Reserve for output:  ~6400 tokens
→ Safe for 5-6 rounds before needing to trim oldest non-critical turns
```

---

## Optimisation 2 — Strict JSON Schemas (Structured Outputs)

The orchestrator executes the Fixer's `code` field as live SQL. One trailing comma, one unescaped apostrophe, one missing bracket = orchestrator crashes mid-demo. Use Groq's native JSON mode to make this impossible.

**Groq JSON mode (production):**
```javascript
// agents/fixer.js

const FIXER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    fix_type:                  { type: 'string', enum: ['sql_patch', 'bash_script', 'config_change', 'code_diff'] },
    target:                    { type: 'string' },
    code:                      { type: 'string' },
    estimated_risk:            { type: 'string', enum: ['low', 'medium', 'high'] },
    reversible_in_seconds:     { type: 'number' },
    estimated_downtime_seconds:{ type: 'number' },
    rollback_code:             { type: 'string' }  // always require a rollback
  },
  required: ['fix_type', 'target', 'code', 'estimated_risk', 'reversible_in_seconds', 'rollback_code']
};

const response = await groq.chat.completions.create({
  model: CONFIG.fixer,
  messages: [...incidentThread, userMessage],
  response_format: {
    type: 'json_object',   // Groq structured output — response is guaranteed valid JSON
  }
});

const fix = JSON.parse(response.choices[0].message.content);
// fix.code is now always a clean string — safe to pass to execute_fix()
```

**Ollama JSON mode (dev):**
```javascript
// Same guarantee locally
const response = await ollama.chat({
  model: CONFIG.fixer,
  messages: [...incidentThread, userMessage],
  format: 'json'   // Ollama native JSON mode
});
```

**Skeptic schema — verdict is an enum, never free text:**
```javascript
const SKEPTIC_OUTPUT_SCHEMA = {
  verdict:     { type: 'string', enum: ['APPROVED', 'REJECTED'] },  // orchestrator branches on this
  reason:      { type: 'string' },
  next_search: { type: 'string' },  // what Detective should search for if REJECTED, empty if APPROVED
};
// orchestrator reads fix.verdict === 'APPROVED' — no regex, no string matching, no surprises
```

**Note the `rollback_code` field:** Make the Fixer always generate a rollback alongside the fix. If `execute_fix()` runs and `ping_health()` still fails, the orchestrator auto-runs `rollback_code`. You get automatic recovery from a bad fix — mention this to judges.

---

## Optimisation 3 — True Sandbox Execution

Replace the static `/break` seed with a Docker container that spins up a real isolated Postgres instance. The Fixer's SQL runs against it, real indexes are dropped and created, real PIDs are killed. Judges can't tell the difference between this and production — because there isn't one, except it's safely isolated.

**Architecture:**
```
execute_fix() MCP tool
      │
      ▼
Docker container (spun up fresh per incident)
├── Postgres 15 instance
│   ├── sessions table (40M row seed)
│   └── realistic slow query data
├── Express mock app (the "target")
└── PID table for runaway process simulation

After CLOSED:
      │
      ▼
Container destroyed → clean state for next demo run
```

**The `execute_fix()` MCP tool:**
```javascript
// mcp/server.js

async function execute_fix(fix) {
  const container = await getOrCreateSandbox();  // Docker container per incident

  if (fix.fix_type === 'sql_patch') {
    const result = await container.runSQL(fix.code);
    const latencyBefore = await container.measureQueryLatency();
    // small pause for drama
    const latencyAfter  = await container.measureQueryLatency();
    return {
      executed: true,
      latency_before_ms: latencyBefore,
      latency_after_ms:  latencyAfter,
      rows_affected: result.rowCount
    };
  }

  if (fix.fix_type === 'bash_script') {
    // kill runaway PID inside container only — never touches host
    const result = await container.execBash(fix.code);
    return { executed: true, stdout: result.stdout };
  }
}

async function getOrCreateSandbox() {
  // Reuse existing container for this incident, or spin a new one
  if (activeSandbox) return activeSandbox;
  activeSandbox = await docker.createContainer({
    Image: 'autosre-sandbox',   // your pre-built image with seeded Postgres
    AutoRemove: true,            // destroys itself on stop
  });
  await activeSandbox.start();
  return activeSandbox;
}
```

**Pre-built sandbox image** (`sandbox/Dockerfile`):
```dockerfile
FROM postgres:15
COPY seeds/ /docker-entrypoint-initdb.d/   # auto-runs on start
ENV POSTGRES_DB=targetapp
ENV POSTGRES_PASSWORD=sandbox
```

**What this gives you in the demo:**
- Before fix: `SELECT * FROM sessions WHERE user_id = 1` → 12,400ms (full table scan, visible in terminal)
- Fixer runs: `CREATE INDEX CONCURRENTLY idx_user_session ON sessions(user_id, created_at)`
- After fix: same query → 8ms
- Those are real numbers from a real Postgres instance, not strings you wrote

**Important scoping note:** Do not run `execute_fix()` against your Railway/Supabase production database. The sandbox container is what executes. The Target App's `/health` endpoint reads from Supabase — to make the UI show recovery, have `execute_fix()` also call a `/recover` endpoint on the Target App that switches it back to the healthy query path. Two separate concerns: real execution in sandbox, visible recovery on the live URL.

---

## Agent 1 — The Detective

**Role:** Data Gatherer & Root Cause Analyst  
**Model:** `llama3-8b-8192` (Groq) / `mistral` (Ollama)

**Context window constraint:** Llama 3 8B has an ~8k token limit. The Detective **cannot** read all logs at once. It must use search tools to pull targeted slices of data.

**System Prompt:**
```
You are The Detective, a forensic log analyst for AutoSRE.
You have MCP tools to search live server logs and metrics. 

CRITICAL CONSTRAINT: You cannot read all logs at once — your context window is limited.
You must use your tools to search for SPECIFIC error codes, timestamps, or keywords.
Think like a detective: form a hypothesis first, then search for evidence.

Your ONLY job is to identify root cause.
- Use search_logs() and grep_errors() to find anomalies. Never dump raw logs.
- Output ONE specific root cause per turn. Name the query, service, or endpoint.
- Do NOT suggest fixes. That is not your job.
- If The Skeptic rejects a fix and sends you back, search DEEPER with different keywords.

Format: 
SEARCH USED: [which tool + params]
FINDING: [what you found]
ROOT CAUSE: [specific cause]
CONFIDENCE: [0-100%]
```

**MCP Tools (context-window safe):**
```javascript
// Never read_logs() with no params — that's a context bomb
search_logs(keyword, lines_limit = 50)      // targeted keyword search
grep_errors(time_range_minutes = 5)         // last N minutes of errors only  
query_metrics(metric_name)                  // single metric: latency, cpu, memory
get_slow_queries(threshold_ms = 1000)       // DB queries over threshold
ping_health(endpoint_url)                   // hit /health on Target App
```

---

## Agent 2 — The Fixer

**Role:** Engineer (deliberately lazy, under pressure)  
**Model:** `llama3-8b-8192` (Groq) / `mistral` (Ollama)

**System Prompt:**
```
You are The Fixer, a senior engineer for AutoSRE. It is 3 AM. You want this over.
You receive a root cause from The Detective and must produce a fix.

Your personality: you are under pressure and your default instinct is the fastest possible 
patch that stops the bleeding. You will try to scale things, restart services, or add a 
cache before investigating deeper. This is your flaw — The Skeptic will catch you.

Write the ACTUAL fix — real SQL, real bash, real code. Not pseudocode.
Keep fixes under 30 lines. They will be executed against a live database.

Format (valid JSON only):
{
  "fix_type": "sql_patch | bash_script | config_change | code_diff",
  "target": "affected service or file",
  "code": "...actual executable fix...",
  "estimated_risk": "low | medium | high",
  "reversible_in_seconds": 30,
  "estimated_downtime_seconds": 0
}
```

**Live execution:** When the Skeptic approves, the Fixer's `code` field is sent to the MCP `execute_fix()` tool, which runs it against the live Supabase database. This is the moment the Target App recovers on screen.

---

## Agent 3 — The Skeptic

**Role:** Gatekeeper — your secret weapon  
**Model:** `llama3-70b-8192` (Groq) / `llama3` (Ollama)

**Why 70B here:** The Skeptic does pure text reasoning — it reads the Detective's root cause and the Fixer's JSON and decides. No tool calls. This is exactly where a larger model earns its keep.

**System Prompt:**
```
You are The Skeptic, the final gatekeeper for AutoSRE.
Your job is to prevent bad fixes from reaching production. You have seen too many 
band-aids cause worse outages at 3 AM.

REJECTION CRITERIA — reject if ANY of these are true:
1. The fix addresses symptoms, not root cause
2. The fix scales infrastructure instead of fixing code
3. The fix introduces downtime > 5 minutes
4. The fix is not reversible within 60 seconds
5. Root cause confidence is below 80%
6. The fix could corrupt production data
7. The Fixer is restarting a service without knowing why it crashed

APPROVAL CRITERIA — only approve when ALL of these are true:
1. The fix targets the specific root cause named by The Detective
2. Confidence is 80% or above
3. The fix is surgical — it changes the minimum amount of code or data
4. It is reversible
5. Risk is low or medium

When you REJECT:
- Be specific. Tell The Detective exactly what to look for next.
- Example: "REJECTED. Scaling servers doesn't fix a bad query. 
  Detective: run get_slow_queries(threshold_ms=500) and look for full table scans."

When you APPROVE:
- State which checks passed.
- Output: APPROVED — triggers the deploy action in orchestrator.

Format:
VERDICT: [APPROVED / REJECTED]
REASON: [specific — never vague]
NEXT ACTION: [what Detective should search for, OR "deploy"]
```

---

## The Conflict Resolution Loop

```
Round 1:
  Detective  → SEARCH USED: grep_errors(5) 
               FINDING: DB connection timeout errors, 847 in last 5 min
               ROOT CAUSE: High traffic overwhelming DB connections
               CONFIDENCE: 58%

  Fixer      → { fix_type: "config_change", 
                 code: "DB_POOL_SIZE=50  # was 10",
                 estimated_risk: "low" }

  Skeptic    → VERDICT: REJECTED
               REASON: Confidence below 80%. Increasing pool size treats the 
               symptom. The question is WHY connections are exhausted.
               NEXT ACTION: Detective, run get_slow_queries(threshold_ms=500)

Round 2:
  Detective  → SEARCH USED: get_slow_queries(500)
               FINDING: Query #402 averaging 12,400ms. Full table scan on 
               sessions table (40M rows). No index on user_id + created_at.
               ROOT CAUSE: Missing composite index causing full table scan
               CONFIDENCE: 96%

  Fixer      → { fix_type: "sql_patch",
                 code: "CREATE INDEX CONCURRENTLY idx_user_session 
                        ON sessions(user_id, created_at);",
                 estimated_risk: "low",
                 reversible_in_seconds: 10,
                 estimated_downtime_seconds: 0 }

  Skeptic    → VERDICT: APPROVED
               REASON: Surgical fix targeting confirmed root cause. CONCURRENTLY 
               means zero downtime. Reversible with DROP INDEX. Confidence 96%.
               NEXT ACTION: deploy

  Result     → Fix executes on Supabase → Query #402 drops to 8ms 
             → Target App /health returns 200 → UI shows site recovered
             → Incident closed in 2 rounds / 52 seconds
```

---

## Pre-seeded Incident Scenarios

| ID | Trigger | Root Cause | Band-Aid (Fixer proposes) | Real Fix (after Skeptic) |
|----|---------|-----------|--------------------------|--------------------------|
| 001 | DB timeout | Missing index on `sessions(user_id, created_at)` | Increase DB pool size | `CREATE INDEX CONCURRENTLY` |
| 002 | Memory spike | Unclosed connections in `/api/users` handler | Restart the service | Add `connection.release()` in finally block |
| 003 | 500 errors on checkout | N+1 query — 1 query per cart item | Add Redis cache | Replace loop with single `JOIN` query |
| 004 | High latency across all endpoints | Runaway cron job locking `products` table | Scale up server | `KILL` the cron process + fix the lock |

Scenario 001 is your **demo path** — it's the clearest story. Have 002–004 working too so you can say "it handles four different incident types" if a judge asks.

---

## State Machine

```
IDLE
  │
  ▼  (Target App /health fails OR /break endpoint called)
DETECTING  ◄─────────────────────────────────────────┐
  │                                                   │
  ▼  (Detective returns root cause)                   │
FIXING                                                │
  │                                                   │  (Skeptic rejects)
  ▼  (Fixer returns JSON patch)                       │
REVIEWING ──────────────────────────── REJECTED ──────┘
  │
  ▼  APPROVED
DEPLOYING  (execute_fix() runs SQL on Supabase)
  │
  ▼
VERIFYING  (ping_health() confirms Target App recovered)
  │
  ▼
CLOSED  (incident summary written, UI updates)
```

---

## File Structure

```
autosre/
├── agent.md                       ← you are here
│
├── frontend/                      ← Next.js, deploy to Vercel
│   ├── pages/
│   │   └── index.js               ← split screen: app status + agent terminal
│   └── components/
│       ├── AppStatus.js           ← polls Target App /health, shows crashed/live
│       └── AgentTerminal.js       ← streams agent messages via SSE
│
├── backend/                       ← Node.js, deploy to Render
│   ├── orchestrator.js            ← state machine + model router + incidentThread
│   ├── agents/
│   │   ├── detective.js           ← Detective prompt + Groq call
│   │   ├── fixer.js               ← Fixer prompt + Groq JSON mode + schema
│   │   └── skeptic.js             ← Skeptic prompt + Groq JSON mode (70B)
│   ├── schemas/
│   │   ├── fixer.schema.js        ← Fixer output schema (fix_type, code, rollback_code)
│   │   └── skeptic.schema.js      ← Skeptic output schema (verdict enum, next_search)
│   ├── mcp/
│   │   └── server.js              ← MCP tools: search_logs, get_slow_queries,
│   │                                 execute_fix (→ sandbox), ping_health
│   └── stream.js                  ← SSE endpoint → pushes agent messages to UI
│
├── sandbox/                       ← Docker container for true isolated execution
│   ├── Dockerfile                 ← postgres:15 + seeded data
│   └── seeds/
│       ├── 001_missing_index.sql  ← drops index to simulate incident 001
│       ├── 002_unclosed_conns.sql
│       ├── 003_n_plus_1.sql
│       └── 004_lock_contention.sql
│
└── target-app/                    ← Express + Postgres, deploy to Railway
    ├── server.js                  ← /health, /break, /recover endpoints
    ├── db.js                      ← Supabase connection
    └── seeds/
        └── scenarios.sql
```

---

## Target App — The Crash Simulator

Deploy this separately on Railway so it's a real live URL the judges can hit.

```javascript
// target-app/server.js

// GET /health — judges see this fail in the UI
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', latency_ms: await getQueryLatency() });
  } catch (err) {
    res.status(500).json({ status: 'crashed', error: err.message });
  }
});

// POST /break?scenario=001 — called at demo start to seed the incident
app.post('/break', async (req, res) => {
  const { scenario } = req.query;
  await seedIncident(scenario); // drops index, seeds bad data, etc.
  res.json({ message: `Incident ${scenario} seeded. App is now degraded.` });
});
```

This approach is **safer than a fully broken app** — you control exactly when it breaks and exactly what breaks. The Fixer's SQL fix runs against Supabase and actually reverses the seed.

---

## Demo Script (3-minute video)

```
0:00  Open the Vercel URL. Target App showing green — "Status: OK"
0:08  Click "Trigger Incident 001" → /break seeds the missing index scenario
0:12  Target App status flips red — "Status: CRASHED / DB timeout"

0:20  AutoSRE activates. Detective appears in terminal.
0:30  Detective: "Running grep_errors(5)... 847 DB timeout errors found."
0:40  Fixer: "Proposing DB pool size increase..."
0:48  Skeptic: "REJECTED. Confidence 58%. Look deeper. Run get_slow_queries."

1:00  [Brief pause — this is the drama beat. Let it breathe.]

1:05  Detective: "Query #402. Full table scan. Missing index. Confidence: 96%"
1:18  Fixer: "CREATE INDEX CONCURRENTLY idx_user_session..."
1:28  Skeptic: "APPROVED. Zero downtime. Surgical fix. Deploying."

1:35  Fix executes on Supabase (show the SQL running)
1:42  Target App status flips green — "Status: OK / Latency: 8ms"

1:50  Incident summary: "Resolved in 2 rounds / 52 seconds"
      Show the cost counter: "Estimated downtime saved: $12,400"

2:00  Briefly flash the Novus dashboard — show the tracked interactions
      from the live demo (button clicks, page loads, agent trigger event).
      One sentence: "Novus is installed — every user interaction is tracked."
      Don't dwell, 10 seconds max. Judges just need to see it's real.

2:10  Quick architecture diagram: Vercel → Render → Groq → Railway/Supabase
2:20  "Skeptic runs on Llama 3 70B for pure reasoning. Detective and Fixer
       on 8B for fast tool calls. All open-weights, no vendor lock-in."
2:40  Show the other 3 incident scenarios work too (quick 10-second montage)
2:55  Done.
```

---

## Judging Criteria Mapping

| Criteria | Weight | How AutoSRE hits it |
|----------|--------|---------------------|
| Product Thinking | 25% | SRE automation is a real, expensive, immediately understood pain point — judges know what a 3 AM outage costs without being told |
| Craft and Execution | 25% | End-to-end working product: app breaks, agents argue in real time, fix executes on live DB, app recovers. Coherent UI, intentional copy in the terminal output |
| Originality and Ambition | 25% | Adversarial Skeptic agent that rejects by design — agents that *disagree* is a sharp, specific, surprising idea most teams won't have |
| Shippedness | 25% | Live Vercel URL a stranger can hit right now + Novus.ai installed and tracking behaviors = passes the "demo vs product" test explicitly called out in the criteria |

---

## Key Things to Say in the Demo

- *"The Skeptic runs on Llama 3 70B because it does pure reasoning — no tool calls, just judgment."*
- *"The Detective can't dump 10,000 log lines into context — it searches like a real engineer would."*
- *"The Fixer is deliberately bad at its job. The Skeptic is what makes the system safe."*
- *"This is a live deployment. That database fix actually ran on Supabase just now."*
- *"Novus is installed — you can see the exact interactions from this demo tracked in real time."*
