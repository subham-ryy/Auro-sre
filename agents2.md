# AutoSRE — Architecture & Progress Report

This document outlines the current state, achievements, and roadmap for the **AutoSRE** project as of the latest iteration. The system is a fully functional, local, open-weights AI agent network designed to autonomously detect, debate, and resolve production incidents.

---

## 1. What We Have Achieved

We successfully built an end-to-end "Agentic Incident Response" system. The architecture connects a Next.js frontend, an Express/Node.js orchestrator, a local Ollama LLM, and a simulated target application.

### The "Society of Three Agents"
We implemented a strict, adversarial debate loop using three distinct agent personas:
*   **The Detective:** A forensic investigator that strictly uses MCP tools to find evidence (logs, slow queries) and determine root causes.
*   **The Fixer:** An engineer that writes executable patches (SQL/Bash). It is deliberately prompted to be "under pressure" and occasionally suggest band-aid fixes (like restarting servers).
*   **The Skeptic:** The gatekeeper. It reviews the Fixer's patches against the Detective's findings and rejects them if they are band-aids, introducing a "Skeptical Loop" that forces the system to find the *real* root cause.

### Solving the Infinite Hallucination Loop
During initial testing with local Ollama (`llama3.1`), the agents were stuck in an infinite loop where the Skeptic rejected identical fixes over and over. We identified and fixed 5 root causes to solve this:
1.  **Invalid Message Roles Killed Conversation Memory:** Updated `appendToThread` to use the `assistant` role while prefixing the content with `[AGENT_NAME]:` to prevent Ollama from dropping history.
2.  **No Round Number Passed to Agents:** The orchestrator now passes the explicit round number directly into the user message context.
3.  **Detective Always Called the Same MCP Tool:** The orchestrator now controls tool execution: Round 1 forces `grep_errors` for surface-level analysis, while Round 2+ forces `get_slow_queries` for deep investigation.
4.  **Skeptic Rejected the Correct Fix:** Rewrote `skeptic.js` to explicitly teach that `CREATE INDEX` for a confirmed missing index IS a root cause fix, NOT a band-aid.
5.  **Skeptic's Feedback Never Reached the Detective:** The orchestrator now stores `lastRejection` and forwards it directly to the next `runDetective` call so the investigation actually progresses.

### Multi-Scenario Incident Support (Scenario 002: Connection Pool Leak)
To prove the system's robust capability, we expanded the depth of AutoSRE beyond Scenario 001 (Missing Index):
*   **Scenario 002 (Connection Pool Leak):** Implemented a `/break-pool` endpoint in the target application (`target-app/server.js`) that deliberately acquires a connection using `pool.connect()` but omits the mandatory `client.release()`, saturating the pool (`DB_POOL_MAX=20`).
*   **Orchestration Logic:** The backend incident trigger accepts the scenario ID. For Scenario 002, it runs a dedicated detective/fixer/skeptic loop analyzing pool exhaustion warnings.
*   **Resolution:** The Fixer detects the leak and generates a code patch calling `.release()` or utilizing proper connection pools, resolving the starvation issue.

### Human-in-the-Loop (HITL) Governance Guardrails
To prevent autonomous agents from running dangerous or untested patches directly in production without human oversight, we implemented a comprehensive Governance Guardrail flow:
*   **Auto-Remediation Toggle:** A reactive, prominent safety lock toggle switch (`autoExecute`) on the dashboard allowing operators to select:
    *   **AUTO-REMEDIATION: ACTIVE** (Green Glow): Full autonomous execution.
    *   **HUMAN-IN-THE-LOOP: REQUIRED** (Amber/Warning Glow): Pauses before any code is deployed.
*   **Approval & Abort Workflows:** When in HITL mode, the backend halts execution right before the deployment step and broadcasts a `system` event with payload `AWAITING_APPROVAL`.
*   **UI Overlay Panel:** When the UI detects `AWAITING_APPROVAL`, it pauses visual updates and renders a prominent overlay labeled **⚠️ GOVERNANCE GUARDRAIL: APPROVAL REQUIRED**. It presents the proposed code patch with green **CONFIRM & DEPLOY** and red **ABORT** buttons, triggering endpoints `/api/incident/approve` or `/api/incident/abort` respectively.

### Real-Time Agent State Synchronization
*   **Node Animation Tracking:** Resolved state synchronization delays by broadcasting explicit `agent_state` events via SSE (`/stream`) immediately before and after each agent runs.
*   **Dynamic UI State Transitions:** The frontend Agent Network graph dynamically reflects real-time status:
    *   *Idle:* Translucent state indicating inactivity.
    *   *Processing:* Throbbing amber/yellow indicating the agent is actively executing.
    *   *Completed:* Solid green indicating the agent successfully finished its task.

### UI Command Center Upgrades & Layout Fixes
*   **Optimized Space Distribution:** Relocated the Scenario Selector dropdown to the Agent Network panel header to free up vertical space in the left panel.
*   **Compact Telemetry:** Reduced padding and margins to prevent vertical overflow and ensure the dashboard fits perfectly on 1080p screens.
*   **Trigger Restoration:** Restored the large **TRIGGER INCIDENT (ARM → FIRE)** button at the bottom of the left column.
*   **JSX Cleanup:** Corrected mismatched `</div>` and `<Panel>` structures to ensure compile-time stability.

---

## 2. Current Status

**Status: FULLY FUNCTIONAL (Multi-Scenario, Human-in-the-Loop Enabled)**

The system dynamically switches between Scenario 001 and Scenario 002. In both flows, it respects the governance configuration and animates agent states flawlessly.

---

## 3. The Roadmap: What is Left to Do

### Phase 1: Sandbox Safety Layer & Validation
*   **Task:** Add a syntax validation and safety sandbox to the orchestrator execution engine. Automatically reject or query for verification if a generated SQL patch contains destructive queries like `DROP TABLE` or `DELETE FROM` with no `WHERE` clause.

### Phase 2: N+1 Query Diagnosis (Scenario 003)
*   **Task:** Mock database round-trip times and design a Scenario 003 representing N+1 query structures. The Fixer must identify and resolve this by rewriting queries with explicit SQL `JOIN`s.

### Phase 3: Cloud Deployment
*   **Frontend:** Deploy the React app to **Vercel**.
*   **Backend:** Deploy the Orchestrator/Express server to **Render**.
*   **Target App & DB:** Deploy the Express crash simulator to **Railway** with a live database instance.
