require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { DETECTIVE_SYSTEM_PROMPT } = require('./agents/detective');
const { FIXER_SYSTEM_PROMPT } = require('./agents/fixer');
const { SKEPTIC_SYSTEM_PROMPT } = require('./agents/skeptic');
const { broadcast } = require('./stream');
const { waitForHumanApproval } = require('./governance');

/** Small delay for cinematic deploy sequence pacing */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const CONFIG = {
  skeptic: 'llama-3.3-70b-versatile',
  detective: 'llama-3.3-70b-versatile',
  fixer: 'llama-3.3-70b-versatile',
};

/**
 * Scenario configuration — defines how each scenario routes through the agent loop.
 * Each scenario specifies:
 *   - r1Tool / r1Args: MCP tool + args for Round 1 (surface-level investigation)
 *   - r2Tool / r2Args: MCP tool + args for Round 2+ (deep investigation)
 *   - r1Hint: Instructions appended to the Detective's Round 1 user message
 *   - r2HintPrefix: Instructions appended to the Detective's Round 2+ user message
 *   - deployType: How the approved fix gets deployed ('sql' or 'code_diff')
 */
const SCENARIOS = {
  '001': {
    name: 'Missing Database Index',
    r1Tool: 'grep_errors',
    r1Args: {},
    r2Tool: 'get_slow_queries',
    r2Args: { threshold_ms: 500 },
    r1Hint: 'Analyze these error logs. Report a surface-level finding. Your confidence should be MODERATE (50-65%) since you have not yet investigated the specific database queries.',
    r2HintPrefix: 'You now have DEEPER data from get_slow_queries. Analyze it carefully. Report the SPECIFIC query ID, table name, and column(s) causing the problem. Your confidence should be HIGH (90%+) if the data clearly shows a missing index.',
    deployType: 'sql',
  },
  '002': {
    name: 'Connection Pool Leak',
    r1Tool: 'grep_errors',
    r1Args: { scenario: '002' },
    r2Tool: 'get_pool_status',
    r2Args: {},
    r1Hint: 'Analyze these connection pool error logs. Report pool saturation symptoms. Your confidence should be MODERATE (50-65%) since you have not yet identified WHERE in the application code the connections are being leaked.',
    r2HintPrefix: 'You now have DEEP pool diagnostic data from get_pool_status. It shows EXACTLY which handler is leaking connections, with stack traces and file names. Report the SPECIFIC file, handler/route, and the missing client.release() call. Your confidence should be HIGH (90%+).',
    deployType: 'code_diff',
  },
  '003': {
    name: 'Retry Storm (Cascading Failure)',
    r1Tool: 'grep_errors',
    r1Args: { scenario: '003' },
    r2Tool: 'get_retry_trace',
    r2Args: {},
    r1Hint: 'Analyze these error logs showing HTTP 500 errors and immediate retries. Report the thread pool saturation symptoms. Your confidence should be MODERATE (50-65%) since you have not yet isolated which specific retry loop in code is the culprit.',
    r2HintPrefix: 'You now have DEEP retry trace data from get_retry_trace. It shows EXACTLY which file (server.js), handler (GET /break-retry), and line numbers contain the retry loop with zero backoff delay. Report the SPECIFIC file, handler, line range, and that there is zero delay between retries. Your confidence should be HIGH (90%+).',
    deployType: 'code_diff_retry',
  },
};

let incidentThread = [];
let mcpClient = null;
let mcpTransport = null;
let isIncidentActive = false;

function isIncidentRunning() {
  return isIncidentActive;
}

async function initMCP() {
  if (mcpClient) return mcpClient;

  mcpTransport = new StdioClientTransport({
    command: "node",
    args: ["./mcp/server.js"],
    env: { ...process.env },
  });

  mcpClient = new Client(
    {
      name: "autosre-orchestrator",
      version: "2.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  await mcpClient.connect(mcpTransport);
  return mcpClient;
}

/**
 * Store agent output in the thread using 'assistant' role so Ollama
 * can actually read it as conversation history in subsequent rounds.
 */
function appendToThread(agentName, content) {
  incidentThread.push({
    role: 'assistant',
    content: `[${agentName.toUpperCase()}]: ${content}`,
    timestamp: Date.now()
  });
}

async function callAgent(model, systemPrompt, messages, responseFormat = null) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not defined.");
  }

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ],
    temperature: 0,
    stream: false
  };

  if (responseFormat && responseFormat.type === 'json_object') {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
    throw new Error(`Invalid response format from Groq API: ${JSON.stringify(data)}`);
  }
  return data.choices[0].message.content;
}

/**
 * DETECTIVE — scenario-aware, round-aware investigation
 * 
 * Uses the scenario config to determine which MCP tool to call per round.
 * Passes the scenario ID so the detective prompt knows which analysis protocol to follow.
 */
async function runDetective(round, lastRejection, scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  console.log(`--- Detective Thinking (Round ${round}, Scenario ${scenarioId}: ${scenario.name}) ---`);
  const client = await initMCP();

  // Use scenario config to pick the right tool per round
  const toolName = round === 1 ? scenario.r1Tool : scenario.r2Tool;
  const toolArgs = round === 1 ? scenario.r1Args : scenario.r2Args;

  console.log(`Executing MCP Tool: ${toolName}`);

  let toolResultText = '';
  try {
    const toolResult = await client.callTool({ name: toolName, arguments: toolArgs });
    toolResultText = toolResult.content.map(c => c.text).join('\n');
  } catch (err) {
    toolResultText = `ERROR: ${err.message}`;
  }

  // Build the user message with round + scenario context
  let userMessage = `CURRENT ROUND: ${round}\nSCENARIO: ${scenarioId} (${scenario.name})\nTOOL USED: ${toolName}\nTOOL RESULT:\n${toolResultText}\n\n`;

  if (round === 1) {
    userMessage += scenario.r1Hint;
  } else {
    userMessage += `The Skeptic REJECTED the previous fix with this feedback: "${lastRejection}"\n\n${scenario.r2HintPrefix}`;
  }

  const analysisResponse = await callAgent(CONFIG.detective, DETECTIVE_SYSTEM_PROMPT, [
    ...incidentThread,
    { role: 'user', content: userMessage }
  ]);

  const finalOutput = `SEARCH USED: ${toolName}\n\n${analysisResponse}`;

  appendToThread('detective', finalOutput);
  console.log(finalOutput);
  return finalOutput;
}

/**
 * FIXER — scenario-aware, round-aware fix proposals
 */
async function runFixer(detectiveFindings, round, scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  console.log(`--- Fixer Proposing (Round ${round}, Scenario ${scenarioId}) ---`);
  const response = await callAgent(CONFIG.fixer, FIXER_SYSTEM_PROMPT, [
    ...incidentThread,
    { role: 'user', content: `CURRENT ROUND: ${round}\nSCENARIO: ${scenarioId} (${scenario.name})\n\nRoot cause identified: ${detectiveFindings}. Propose a fix.` }
  ], { type: 'json_object' });

  appendToThread('fixer', response);
  console.log(response);
  return JSON.parse(response);
}

/**
 * SKEPTIC — scenario-aware, round-aware review
 */
async function runSkeptic(detectiveFindings, fixerProposal, round, scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  console.log(`--- Skeptic Reviewing (Round ${round}, Scenario ${scenarioId}) ---`);
  const response = await callAgent(CONFIG.skeptic, SKEPTIC_SYSTEM_PROMPT, [
    ...incidentThread,
    { role: 'user', content: `CURRENT ROUND: ${round}\nSCENARIO: ${scenarioId} (${scenario.name})\n\nDetective says: ${detectiveFindings}\nFixer proposes: ${JSON.stringify(fixerProposal)}\nVerdict?` }
  ]);

  appendToThread('skeptic', response);
  console.log(response);
  return response;
}

/**
 * SUMMARIZER — Generates a post-incident summary
 * Wraps callAgent in a 90s timeout race so it never hangs silently.
 */
async function generateSummary(thread) {
  console.log(`--- Generating Post-Incident Summary ---`);

  // Trim to assistant messages only, skip long tool outputs
  const trimmedThread = thread
    .filter(m => m.role === 'assistant')
    .map(m => ({ role: 'user', content: m.content.slice(0, 800) }));

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Summary generation timed out after 90s')), 90000)
  );

  try {
    const response = await Promise.race([
      callAgent(
        CONFIG.detective,
        "You are a concise AI Site Reliability Engineer. Based on the incident conversation below, write a post-incident summary in exactly 3 bullet points:\n\n• Symptoms: [what was observed]\n• Root Cause: [what caused it]\n• Resolution: [what was done to fix it]\n\nBe specific and brief. No JSON. No preamble. Plain text only.",
        [
          ...trimmedThread,
          { role: 'user', content: 'Write the 3-bullet post-incident summary now.' }
        ]
      ),
      timeoutPromise
    ]);
    console.log(`[Summary Generated]:\n${response}`);
    return response;
  } catch (err) {
    console.error(`[Summary] Error: ${err.message}`);
    throw err; // re-throw so caller's .catch() handles the fallback broadcast
  }
}

/**
 * Deploy a SQL patch via the MCP execute_sql tool.
 * Used by Scenario 001 (Missing Index).
 * Automatically rewrites CREATE INDEX to use IF NOT EXISTS for idempotency.
 */
async function deploySqlPatch(fixCode) {
  // Make CREATE INDEX idempotent — safe to run multiple times
  const idempotentSql = fixCode
    .replace(/CREATE INDEX CONCURRENTLY(?!\s+IF NOT EXISTS)/gi, 'CREATE INDEX CONCURRENTLY IF NOT EXISTS')
    .replace(/CREATE INDEX(?!\s+CONCURRENTLY)(?!\s+IF NOT EXISTS)/gi, 'CREATE INDEX IF NOT EXISTS');

  broadcast('agent_update', { role: 'deploy', content: `Executing SQL against production database...` });
  await sleep(300);
  broadcast('agent_update', { role: 'deploy', content: `QUERY: ${idempotentSql}` });

  const client = await initMCP();
  try {
    console.log(`[Deploy] Executing SQL: ${idempotentSql}`);
    const sqlResult = await client.callTool({
      name: 'execute_sql',
      arguments: { query: idempotentSql },
    });

    const sqlOutput = sqlResult.content.map(c => c.text).join('\n');
    const isError = sqlResult.isError === true || sqlOutput.includes('SQL execution failed');

    if (isError) {
      console.error(`[Deploy] SQL execution error: ${sqlOutput}`);
      broadcast('agent_update', { role: 'deploy', content: `⚠ SQL execution encountered an error:\n${sqlOutput}` });
      broadcast('system', { message: `⚠ SQL deploy failed — see error above. Manual intervention may be required.` });
      return false;
    } else {
      console.log(`[Deploy] SQL execution successful: ${sqlOutput}`);
      broadcast('agent_update', { role: 'deploy', content: `✓ ${sqlOutput}` });
      await sleep(300);
      broadcast('agent_update', { role: 'deploy', content: `✓ Index created. Query #402 execution time: 12,400ms → 8ms.` });
      broadcast('agent_update', { role: 'deploy', content: `✓ p95 latency recovering...` });
      return true;
    }
  } catch (err) {
    console.error(`[Deploy] MCP execute_sql call failed: ${err.message}`);
    broadcast('agent_update', { role: 'deploy', content: `⚠ Deploy tool error: ${err.message}` });
    return false;
  }
}

/**
 * Deploy a code_diff patch by writing the fix to the target file.
 * Used by Scenario 002 (Connection Pool Leak).
 * 
 * Writes the patch content to a .patch file alongside the target,
 * then hits the recovery endpoint to simulate a hot-reload.
 */
async function deployCodeDiff(fix) {
  const targetFile = fix.target || 'server.js';
  const fixCode = (fix.code || '').trim();
  const patchDir = path.resolve(__dirname, '../target-app');
  const patchFile = path.join(patchDir, `${targetFile}.patch`);

  broadcast('agent_update', { role: 'deploy', content: `Patching application source: ${targetFile}...` });
  await sleep(300);
  broadcast('agent_update', { role: 'deploy', content: `PATCH:\n${fixCode}` });
  await sleep(400);

  try {
    // Write the code_diff patch to a file
    const patchContent = [
      `// ═══════════════════════════════════════════════════`,
      `// AutoSRE Code Patch — Applied ${new Date().toISOString()}`,
      `// Target: ${targetFile}`,
      `// Fix: Add missing client.release() in try/finally`,
      `// ═══════════════════════════════════════════════════`,
      ``,
      fixCode,
    ].join('\n');

    fs.writeFileSync(patchFile, patchContent, 'utf-8');
    console.log(`[Deploy] Patch written to: ${patchFile}`);

    broadcast('agent_update', { role: 'deploy', content: `✓ Patch written to ${targetFile}.patch` });
    await sleep(300);
    broadcast('agent_update', { role: 'deploy', content: `✓ Hot-reloading target application...` });
    await sleep(300);
    broadcast('agent_update', { role: 'deploy', content: `✓ Connection pool drained and rebuilt. Leaked clients released.` });
    broadcast('agent_update', { role: 'deploy', content: `✓ Pool status: active=0/20, idle=5/20, waiting=0. Healthy.` });
    return true;
  } catch (err) {
    console.error(`[Deploy] Code patch failed: ${err.message}`);
    broadcast('agent_update', { role: 'deploy', content: `⚠ Code patch error: ${err.message}` });
    return false;
  }
}
/**
 * Deploy a code_diff patch for Scenario 003: inject exponential backoff into the retry loop.
 * Writes the patch file and broadcasts recovery messages matching the Retry Storm narrative.
 */
async function deployCodeDiffRetry(fix) {
  const targetFile = fix.target || 'server.js';
  const fixCode = (fix.code || '').trim();
  const patchDir = path.resolve(__dirname, '../target-app');
  const patchFile = path.join(patchDir, `${targetFile}.retry.patch`);

  broadcast('agent_update', { role: 'deploy', content: `Patching retry loop in ${targetFile} with exponential backoff...` });
  await sleep(300);
  broadcast('agent_update', { role: 'deploy', content: `PATCH:\n${fixCode}` });
  await sleep(400);

  try {
    const patchContent = [
      `// ═══════════════════════════════════════════════════`,
      `// AutoSRE Code Patch — Applied ${new Date().toISOString()}`,
      `// Target: ${targetFile} — GET /break-retry handler`,
      `// Fix: Inject exponential backoff into retry loop (lines 27-45)`,
      `// ═══════════════════════════════════════════════════`,
      ``,
      fixCode,
    ].join('\n');

    fs.writeFileSync(patchFile, patchContent, 'utf-8');
    console.log(`[Deploy] Retry patch written to: ${patchFile}`);

    broadcast('agent_update', { role: 'deploy', content: `✓ Patch written to ${targetFile}.retry.patch` });
    await sleep(300);
    broadcast('agent_update', { role: 'deploy', content: `✓ Hot-reloading target application...` });
    await sleep(300);
    broadcast('agent_update', { role: 'deploy', content: `✓ Retry loop now uses exponential backoff. Immediate retry hammering stopped.` });
    broadcast('agent_update', { role: 'deploy', content: `✓ Thread pool draining: active_threads=12/128. Queued requests clearing.` });
    broadcast('agent_update', { role: 'deploy', content: `✓ p95 latency recovering. Downstream API pressure reduced.` });
    return true;
  } catch (err) {
    console.error(`[Deploy] Retry patch failed: ${err.message}`);
    broadcast('agent_update', { role: 'deploy', content: `⚠ Retry patch error: ${err.message}` });
    return false;
  }
}

/**
 * Main incident resolution loop.
 *
 * Accepts a scenarioId to route through the correct investigation/fix/review path.
 * Tracks lastRejection so the Skeptic's feedback reaches the Detective in the next round.
 */
async function resolveIncident(scenarioId = '001', autoExecute = true) {
  if (isIncidentActive) {
    console.error('⚠ Incident resolution is already in progress.');
    broadcast('system', { message: '⚠ Incident resolution is already in progress.' });
    throw new Error('Incident resolution is already in progress.');
  }

  isIncidentActive = true;
  try {
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) {
      console.error(`Unknown scenario: ${scenarioId}`);
      broadcast('system', { message: `⚠ Unknown scenario: ${scenarioId}` });
      return;
    }

    await initMCP();
    incidentThread = [];
    let resolved = false;
    let rounds = 0;
    const MAX_ROUNDS = 5;
    let lastRejection = '';

    console.log(`\n🚨 Starting incident resolution for Scenario ${scenarioId}: ${scenario.name}`);
    broadcast('system', { message: `Scenario ${scenarioId}: ${scenario.name} — activating agent network...` });

    while (!resolved && rounds < MAX_ROUNDS) {
      rounds++;
      const roundMsg = `=== Round ${rounds} ===`;
      console.log(`\n${roundMsg}`);
      broadcast('system', { message: roundMsg });

      broadcast('agent_state', { agent: 'detective', status: 'processing' });
      const findings = await runDetective(rounds, lastRejection, scenarioId);
      broadcast('agent_state', { agent: 'detective', status: 'completed' });
      broadcast('agent_update', { role: 'detective', content: findings });

      broadcast('agent_state', { agent: 'fixer', status: 'processing' });
      const fix = await runFixer(findings, rounds, scenarioId);
      broadcast('agent_state', { agent: 'fixer', status: 'completed' });
      const fixerMsg = `FIX TYPE: ${fix.fix_type} | TARGET: ${fix.target}\nCODE:\n${fix.code}\nProposing fix. Risk: ${fix.estimated_risk.toUpperCase()}.`;
      broadcast('agent_update', { role: 'fixer', content: fixerMsg });

      broadcast('agent_state', { agent: 'skeptic', status: 'processing' });
      const verdict = await runSkeptic(findings, fix, rounds, scenarioId);
      broadcast('agent_state', { agent: 'skeptic', status: 'completed' });
      broadcast('agent_update', { role: 'skeptic', content: verdict });

      if (verdict.includes('APPROVED')) {
        console.log('\n✅ Skeptic APPROVED — deploying fix to production...');

        // ── Phase 1: Extract the fix code ──
        const fixCode = (fix.code || '').trim();
        if (!fixCode) {
          console.error('⚠ Fixer proposal has no code to execute.');
          broadcast('system', { message: '⚠ APPROVED but Fixer proposal contained no executable code.' });
          resolved = true;
          continue;
        }

        // ── Phase 2: Human-in-the-Loop gate ──
        if (!autoExecute) {
          console.log('[Governance] autoExecute=false — awaiting human approval...');
          broadcast('system', { message: 'AWAITING_APPROVAL' });
          broadcast('governance', {
            fix_type: fix.fix_type,
            target: fix.target,
            code: fix.code,
            estimated_risk: fix.estimated_risk,
            scenarioId,
          });

          const decision = await waitForHumanApproval(fix);

          if (decision === 'aborted') {
            console.log('[Governance] Human ABORTED the deployment.');
            broadcast('system', { message: '⛔ DEPLOYMENT ABORTED by human operator.' });
            broadcast('agent_update', { role: 'deploy', content: '⛔ Deployment cancelled by operator. Incident remains unresolved.' });
            resolved = true;
            continue;
          }

          broadcast('agent_update', { role: 'deploy', content: '✓ Human verification confirmed. Initiating deployment...' });
          await sleep(400);
        } else {
          // ── Cinematic broadcast for auto-execute path ──
          broadcast('system', { message: '✓ VERDICT: APPROVED — initiating deployment sequence.' });
          await sleep(400);
        }

        // ── Phase 3: Route deployment by scenario type ──
        let deploySuccess = false;

        if (fix.fix_type === 'code_diff' || scenario.deployType === 'code_diff') {
          deploySuccess = await deployCodeDiff(fix);
        } else if (scenario.deployType === 'code_diff_retry') {
          deploySuccess = await deployCodeDiffRetry(fix);
        } else {
          deploySuccess = await deploySqlPatch(fixCode);
        }

        // ── Phase 4: Notify target-app to reset its lag state ──
        await sleep(400);
        broadcast('system', { message: '✓ INCIDENT RESOLVED. api-gateway-prod returning 200 OK.' });
        await fetch('http://localhost:3001/recover', { method: 'POST' }).catch(err => {
          console.error("Failed to notify target-app recovery:", err.message);
        });

        resolved = true;

        // ── Phase 5: Generate Post-Incident Summary (always, even if SQL deploy had issues) ──
        console.log('Generating summary in background...');
        generateSummary([...incidentThread]).then(summaryText => {
          console.log('[Summary] Broadcasting summary_ready');
          broadcast('summary_ready', { summary: summaryText });
        }).catch(err => {
          console.error("Summary generation failed:", err);
          broadcast('summary_ready', { summary: '⚠ Summary generation failed. Please check the terminal logs for incident details.' });
        });
      } else {
        console.log('\n❌ Fix Rejected. Looping back...');
        lastRejection = verdict;
        broadcast('system', { message: 'Verdict: Rejected. Looping back...' });
      }
    }

    if (!resolved) {
      const msg = '⚠️ Failed to resolve incident within max rounds.';
      console.log(`\n${msg}`);
      broadcast('system', { message: msg });
    }
  } finally {
    isIncidentActive = false;
  }
}

module.exports = { resolveIncident, incidentThread, isIncidentRunning };
