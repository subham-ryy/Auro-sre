require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sseHandler } = require('./stream');
const { resolveIncident, isIncidentRunning } = require('./orchestrator');
const { signalApproval, signalAbort, getPendingFix } = require('./governance');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins to allow frontend connection
app.use(cors({ origin: '*' }));
app.use(express.json());

// Endpoint for the frontend to connect to the SSE stream
app.get('/stream', sseHandler);

// Endpoint to manually trigger the AutoSRE resolution loop
app.post('/trigger', async (req, res) => {
  const scenarioId = req.body?.scenarioId || '001';
  const autoExecute = req.body?.autoExecute !== false; // default true

  if (isIncidentRunning && isIncidentRunning()) {
    return res.status(409).json({
      error: 'An incident resolution loop is already running.'
    });
  }

  // We don't await here — the loop runs async, frontend tracks via /stream
  resolveIncident(scenarioId, autoExecute).catch(err =>
    console.error("Incident resolution loop failed:", err)
  );

  res.json({
    message: `AutoSRE resolution loop triggered for Scenario ${scenarioId}.`,
    autoExecute,
  });
});

/**
 * POST /api/incident/approve
 * Human operator confirms the pending fix — unblocks the orchestrator loop.
 */
app.post('/api/incident/approve', (req, res) => {
  const pending = getPendingFix();
  if (!pending) {
    return res.status(409).json({ error: 'No fix is currently awaiting approval.' });
  }
  console.log('[Governance] Human APPROVED deployment.');
  signalApproval();
  res.json({ message: 'Deployment approved. Orchestrator unblocked.' });
});

/**
 * POST /api/incident/abort
 * Human operator cancels the pending fix — orchestrator marks incident as resolved (aborted).
 */
app.post('/api/incident/abort', (req, res) => {
  const pending = getPendingFix();
  if (!pending) {
    return res.status(409).json({ error: 'No fix is currently awaiting approval.' });
  }
  console.log('[Governance] Human ABORTED deployment.');
  signalAbort();
  res.json({ message: 'Deployment aborted.' });
});

/**
 * POST /api/reset
 * Re-sabotages the target app based on the scenarioId.
 */
app.post('/api/reset', async (req, res) => {
  const { scenarioId } = req.body;
  console.log(`[Reset] Request to re-sabotage scenario ${scenarioId}`);

  try {
    if (scenarioId === '001') {
      await fetch('http://localhost:3001/break?scenario=001', { method: 'POST' });
    } else if (scenarioId === '002') {
      await fetch('http://localhost:3001/break-pool?count=10', { method: 'GET' });
    } else if (scenarioId === '003') {
      await fetch('http://localhost:3001/break-retry', { method: 'GET' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Reset] Failed to communicate with target app:', err.message);
    res.status(500).json({ error: `Failed to sabotage target app: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`AutoSRE Backend listening on port ${PORT}`);
  console.log(`SSE Stream available at http://localhost:${PORT}/stream`);
});
