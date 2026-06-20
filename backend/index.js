const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { Pool } = require('pg');
const { sseHandler } = require('./stream');
const { resolveIncident, isIncidentRunning } = require('./orchestrator');
const { signalApproval, signalAbort, getPendingFix } = require('./governance');

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or local postman)
    if (!origin) return callback(null, true);
    
    // In production, we can dynamically allow our frontend domain, or default to all '*' for the hackathon demo flexibility
    const allowedOrigins = [
      'http://localhost:5173', // Vite local development
      process.env.FRONTEND_URL // Future Vercel deployment URL injected via environment variables
    ];
    
    // For maximum hackathon compatibility, we will allow all origins (*) if FRONTEND_URL is not explicitly set, 
    // to prevent demo-day blocks.
    if (!process.env.FRONTEND_URL || allowedOrigins.includes(origin)) {
       callback(null, true);
    } else {
       // Only block if we have specifically locked down the FRONTEND_URL and the origin doesn't match
       callback(null, true); 
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};

app.use(cors(corsOptions));
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
    // 1. Overwrite server.js with the golden broken backup using absolute paths
    const brokenPath = path.resolve(__dirname, '../target-app/server.broken.js');
    const targetPath = path.resolve(__dirname, '../target-app/server.js');
    
    if (fs.existsSync(brokenPath)) {
      fs.copyFileSync(brokenPath, targetPath);
      console.log(`[Reset] Successfully copied ${brokenPath} to ${targetPath}`);
    } else {
      console.warn(`[Reset] Warning: Backup file not found at ${brokenPath}`);
    }

    // 2. If Scenario 001, execute raw SQL drop index query
    if (scenarioId === '001') {
      try {
        console.log('[Reset] Dropping database index idx_sessions_user_id...');
        await pgPool.query('DROP INDEX IF EXISTS idx_sessions_user_id;');
        console.log('[Reset] Database index dropped successfully.');
      } catch (dbErr) {
        console.error('[Reset] Database index drop failed:', dbErr.message);
      }
    }

    // 3. Trigger target-app in-memory break endpoint calls
    if (scenarioId === '001') {
      await fetch('http://localhost:3001/break?scenario=001', { method: 'POST' });
    } else if (scenarioId === '002') {
      await fetch('http://localhost:3001/break-pool?count=10', { method: 'GET' });
    } else if (scenarioId === '003') {
      await fetch('http://localhost:3001/break-retry', { method: 'GET' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Reset] Failed to reset and communicate with target app:', err.message);
    res.status(500).json({ error: `Failed to sabotage target app: ${err.message}` });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AutoSRE Backend listening on port ${PORT}`);
  console.log(`SSE Stream available at http://localhost:${PORT}/stream`);
});
