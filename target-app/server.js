require('dotenv').config();
const express = require('express');
const { pool, queryWithLatency } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// State to track if the app is currently "broken" and by which scenario
let activeScenario = null;

/**
 * GET /health
 * Polls the database and returns status + latency.
 * Used by judges and agents to verify if the app is live or crashed.
 */
app.get('/health', async (req, res) => {
  try {
    // Scenario 001: If active, run a heavy query that triggers the "timeout/slow" state
    let checkQuery = 'SELECT 1';
    if (activeScenario === '001') {
      // Simulate a full table scan on a large dataset
      checkQuery = 'SELECT * FROM sessions WHERE user_id = floor(random() * 1000000)::int ORDER BY created_at DESC LIMIT 1';
    }

    const { latency } = await queryWithLatency(checkQuery);
    
    // If latency is too high (simulated or real), we might consider it "degraded"
    if (latency > 5000) {
      return res.status(500).json({ 
        status: 'degraded', 
        latency_ms: latency, 
        error: 'Database query timeout / High latency detected' 
      });
    }

    res.json({ 
      status: 'ok', 
      latency_ms: latency,
      active_scenario: activeScenario 
    });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(500).json({ 
      status: 'crashed', 
      error: err.message 
    });
  }
});

/**
 * POST /break
 * Seeds an incident scenario to simulate a production failure.
 */
app.post('/break', async (req, res) => {
  const { scenario } = req.query;
  activeScenario = scenario;

  try {
    switch (scenario) {
      case '001':
        // Scenario 001: Missing Index
        // In a real DB, we'd DROP INDEX. For the simulator, 
        // we switch the health check to a path that we know is slow.
        console.log('--- Triggered Scenario 001: Missing Index ---');
        break;
      
      case '002':
        // Scenario 002: Connection Pool Exhaustion
        // We simulate this by holding connections open
        console.log('--- Triggered Scenario 002: Pool Exhaustion ---');
        for (let i = 0; i < 10; i++) {
          pool.connect((err, client, release) => {
            if (err) return console.error('Error acquiring client', err.stack);
            // Never release the client to exhaust the pool
            console.log(`Leaked connection ${i+1}`);
          });
        }
        break;

      default:
        activeScenario = null;
        return res.status(400).json({ error: 'Unknown scenario' });
    }

  res.json({ 
      message: `Incident ${scenario} triggered successfully.`,
      status: 'breaking'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /break-retry
 * Simulates Scenario 003: Retry Storm / Cascading Failure.
 * A downstream API call fails and the handler naively retries 5 times
 * with NO delay — saturating the thread pool with open connections.
 */
app.get('/break-retry', async (req, res) => {
  activeScenario = '003';
  console.log('--- Triggered Scenario 003: Retry Storm / Cascading Failure ---');

  const MAX_RETRIES = 5;
  let attempt = 0;
  let lastError = null;

  // Simulate a downstream dependency that always fails
  const callDownstreamApi = () => {
    return new Promise((_, reject) => {
      // Immediately reject — simulates a hung/failing downstream service
      setTimeout(() => reject(new Error('Downstream API Timeout: 503 Service Unavailable')), 100);
    });
  };

  // Naive retry loop: NO exponential backoff, NO jitter, NO delay
  // This is the bug — it hammers the downstream service and holds threads open
  for (let i = 0; i < MAX_RETRIES; i++) {
    attempt++;
    try {
      console.log(`[Target] Attempt ${attempt}/${MAX_RETRIES}: Calling downstream payment API...`);
      await callDownstreamApi();
      // If we get here (we won't), success
      break;
    } catch (err) {
      lastError = err;
      console.log(`[Target] Downstream API failed. Retrying immediately... (attempt ${attempt}/${MAX_RETRIES})`);
      // BUG: no await sleep() here — immediate retry without any backoff
    }
  }

  console.log(`[Target] All ${MAX_RETRIES} retries exhausted. Thread Pool Saturated. HTTP 500 returned.`);
  res.status(500).json({
    status: 'retry_storm',
    message: `All ${MAX_RETRIES} retry attempts failed with no backoff. Thread pool saturated.`,
    last_error: lastError ? lastError.message : 'Unknown error',
    thread_pool_status: 'SATURATED',
  });
});

/**
 * GET /break-pool
 * Deliberately leaks DB connections by acquiring clients without releasing them.
 * After DB_POOL_MAX (default 20) hits, all subsequent queries will freeze and time out.
 * This is the dedicated trigger for Scenario 002: Connection Pool Leak.
 */
app.get('/break-pool', async (req, res) => {
  activeScenario = '002';
  console.log('--- Triggered Scenario 002 via /break-pool: Pool Exhaustion ---');

  const leakCount = parseInt(req.query.count || '10');
  let leaked = 0;

  for (let i = 0; i < leakCount; i++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT NOW()');
      // DELIBERATELY do NOT call client.release() — this is the bug we want the AI to find
      leaked++;
      console.log(`Leaked connection ${leaked}/${leakCount} (pool total: ${pool.totalCount}, idle: ${pool.idleCount}, waiting: ${pool.waitingCount})`);
    } catch (err) {
      console.error(`Connection leak stopped at ${leaked}: ${err.message}`);
      break;
    }
  }

  res.json({
    message: `Pool leak triggered. ${leaked} connections leaked.`,
    pool_status: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    },
  });
});

/**
 * POST /recover
 * Resets the app to a healthy state.
 * Called by the orchestrator after the agents "fix" the problem.
 */
app.post('/recover', (req, res) => {
  activeScenario = null;
  console.log('--- App Recovered ---');
  res.json({ message: 'App recovered to healthy state.' });
});

app.listen(PORT, () => {
  console.log(`Target App Simulator listening on port ${PORT}`);
});
