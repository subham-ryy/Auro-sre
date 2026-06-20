const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { Pool } = require('pg');

// Use DATABASE_URL from environment
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  family: 4,
  // Strict pool settings to make exhaustion scenarios easier to trigger
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Executes a query and measures its latency.
 */
async function queryWithLatency(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const latency = Date.now() - start;
  return { res, latency };
}

module.exports = {
  pool,
  queryWithLatency,
};
