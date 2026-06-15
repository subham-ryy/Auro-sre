/**
 * AutoSRE Governance Module
 * 
 * Provides the Human-in-the-Loop approval gate.
 * 
 * The orchestrator calls waitForHumanApproval() which returns a Promise
 * that suspends until the /api/incident/approve endpoint fires signalApproval()
 * or /api/incident/abort fires signalAbort().
 * 
 * This module is the single shared state between index.js (HTTP layer)
 * and orchestrator.js (async loop) — no polling, no globals scattered across files.
 */

const EventEmitter = require('events');
const governanceEmitter = new EventEmitter();

let pendingApproval = null; // Holds the current fix payload awaiting human review

/**
 * Called by the orchestrator when autoExecute=false and the Skeptic APPROVED.
 * Suspends the orchestrator's async loop until a human acts.
 * 
 * Returns 'approved' or 'aborted'.
 */
function waitForHumanApproval(fix) {
  pendingApproval = fix;

  return new Promise((resolve) => {
    const onApprove = () => {
      pendingApproval = null;
      governanceEmitter.off('abort', onAbort);
      resolve('approved');
    };
    const onAbort = () => {
      pendingApproval = null;
      governanceEmitter.off('approve', onApprove);
      resolve('aborted');
    };

    governanceEmitter.once('approve', onApprove);
    governanceEmitter.once('abort', onAbort);
  });
}

/** Called by POST /api/incident/approve */
function signalApproval() {
  governanceEmitter.emit('approve');
}

/** Called by POST /api/incident/abort */
function signalAbort() {
  governanceEmitter.emit('abort');
}

/** Returns the current pending fix payload (so the approve endpoint can reference it) */
function getPendingFix() {
  return pendingApproval;
}

module.exports = { waitForHumanApproval, signalApproval, signalAbort, getPendingFix };
