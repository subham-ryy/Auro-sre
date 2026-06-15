const { resolveIncident } = require('./orchestrator');

/**
 * Test script to run the AutoSRE loop against the mock MCP server.
 * This simulates Incident 001 (DB Timeout / Missing Index).
 */
async function testLoop() {
  console.log('🚀 Starting AutoSRE Verification Test (Scenario 001)');
  try {
    await resolveIncident();
    console.log('🏁 Test completed.');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

testLoop();
