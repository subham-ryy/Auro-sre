const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { Client: PgClient } = require("pg");

/**
 * AutoSRE MCP Server v3.0
 * Provides forensic tools for the Detective agent to investigate incidents,
 * execute_sql for deploying SQL fixes, and get_pool_status for pool leak diagnosis.
 */
const server = new Server(
  {
    name: "autosre-forensics",
    version: "3.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Tool Definitions
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_logs",
        description: "Search live server logs for a specific keyword. Returns a targeted slice of logs.",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "Keyword to search for (e.g., 'timeout', '500', 'error')" },
            lines_limit: { type: "number", description: "Max lines to return", default: 50 },
          },
          required: ["keyword"],
        },
      },
      {
        name: "grep_errors",
        description: "Fetch error logs from the last N minutes. Optionally filter by scenario.",
        inputSchema: {
          type: "object",
          properties: {
            time_range_minutes: { type: "number", description: "Minutes of history to search", default: 5 },
            scenario: { type: "string", description: "Scenario ID to filter logs for (e.g., '001', '002')" },
          },
        },
      },
      {
        name: "query_metrics",
        description: "Retrieve a single system metric (latency, cpu, memory, connections).",
        inputSchema: {
          type: "object",
          properties: {
            metric_name: { type: "string", enum: ["latency", "cpu", "memory", "connections"], description: "Metric to query" },
          },
          required: ["metric_name"],
        },
      },
      {
        name: "get_slow_queries",
        description: "Identify database queries exceeding a specific execution threshold.",
        inputSchema: {
          type: "object",
          properties: {
            threshold_ms: { type: "number", description: "Latency threshold in milliseconds", default: 1000 },
          },
        },
      },
      {
        name: "get_pool_status",
        description: "Get detailed connection pool diagnostic data: active/idle/leaked connections, stack traces of unreleased clients, and pool saturation metrics.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_retry_trace",
        description: "Retrieve the retry loop execution trace for Scenario 003. Shows the exact file, function, retry count, missing backoff, and thread pool saturation metrics.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "execute_sql",
        description: "Execute a SQL statement against the live production Postgres database. Use for deploying approved fixes (CREATE INDEX, ALTER TABLE, etc.).",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The SQL statement to execute against the database." },
          },
          required: ["query"],
        },
      },
    ],
  };
});

/**
 * Tool Logic Handlers
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "search_logs": {
      const { keyword } = args;
      // Mock Data Scenario 001: Missing Index / DB Timeout
      if (keyword.toLowerCase().includes("timeout") || keyword.toLowerCase().includes("db")) {
        return {
          content: [{
            type: "text",
            text: `[2024-05-20 14:02:11] ERROR: database connection timeout after 30s\n[2024-05-20 14:02:15] WARN: Pool exhaustion detected. active_conns=10, max_conns=10\n[2024-05-20 14:02:18] ERROR: Failed to execute query "SELECT * FROM sessions WHERE user_id = $1"`,
          }],
        };
      }
      return { content: [{ type: "text", text: "No logs matching keyword found." }] };
    }

    case "grep_errors": {
      const scenario = args.scenario || '001';

      if (scenario === '002') {
        // Scenario 002: Connection Pool Leak
        return {
          content: [{
            type: "text",
            text: [
              `[ERROR] 14:12:01 - ConnectionPoolTimeoutException: Timeout waiting for a connection from the pool`,
              `[ERROR] 14:12:01 - Pool status: active_connections=20/20, idle_connections=0, waiting_requests=47`,
              `[ERROR] 14:12:03 - ConnectionPoolTimeoutException: Timeout waiting for a connection from the pool`,
              `[ERROR] 14:12:03 - Pool status: active_connections=20/20, idle_connections=0, waiting_requests=52`,
              `[WARN]  14:12:05 - Connection held for 180s without release in GET /break-pool handler`,
              `[ERROR] 14:12:08 - All 20 pool connections saturated. New requests will hang indefinitely.`,
              `[ERROR] 14:12:10 - GET /health - 503 Service Unavailable (pool exhaustion)`,
            ].join('\n'),
          }],
        };
      }

      if (scenario === '003') {
        // Scenario 003: Retry Storm / Cascading Failure
        return {
          content: [{
            type: "text",
            text: [
              `[ERROR] 15:01:02 - HTTP 500 - Downstream API Timeout: GET /api/payments -> 503 Service Unavailable`,
              `[ERROR] 15:01:02 - Retrying immediately... attempt 1/5 (no backoff delay)`,
              `[ERROR] 15:01:02 - Retrying immediately... attempt 2/5 (no backoff delay)`,
              `[ERROR] 15:01:02 - Retrying immediately... attempt 3/5 (no backoff delay)`,
              `[ERROR] 15:01:02 - Retrying immediately... attempt 4/5 (no backoff delay)`,
              `[ERROR] 15:01:02 - Retrying immediately... attempt 5/5 (no backoff delay)`,
              `[WARN]  15:01:03 - Thread Pool Saturated: active_threads=128/128, queued_requests=847`,
              `[ERROR] 15:01:04 - HTTP 500 - Downstream API Timeout: GET /api/payments -> 503 Service Unavailable`,
              `[WARN]  15:01:04 - Thread Pool Saturated: active_threads=128/128, queued_requests=1203`,
              `[ERROR] 15:01:06 - Node.js event loop lag: 4200ms — system near unresponsive`,
            ].join('\n'),
          }],
        };
      }

      // Scenario 001 (default): Missing Index
      return {
        content: [{
          type: "text",
          text: `[ERROR] 14:05:01 - ConnectionPoolTimeoutException: Timeout waiting for connection from pool\n[ERROR] 14:05:03 - ConnectionPoolTimeoutException: Timeout waiting for connection from pool\n[ERROR] 14:05:10 - Critical Error in /api/auth/session`,
        }],
      };
    }

    case "query_metrics": {
      const { metric_name } = args;
      const metrics = {
        latency: "Average: 12,400ms (P99: 18,900ms)",
        cpu: "Usage: 12%",
        memory: "Usage: 450MB",
        connections: "Active: 10/10 (100% saturation)",
      };
      return {
        content: [{ type: "text", text: metrics[metric_name] || "Metric not found." }],
      };
    }

    case "get_slow_queries": {
      const { threshold_ms = 1000 } = args;
      return {
        content: [{
          type: "text",
          text: JSON.stringify([
            {
              query_id: 402,
              query: "SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC",
              avg_duration_ms: 12400,
              calls: 154,
              plan: "Seq Scan on sessions (cost=0.00..124500.00 rows=1 width=244)",
              reason: "Full table scan on 40M rows. Missing index on user_id.",
            }
          ], null, 2),
        }],
      };
    }

    case "get_pool_status": {
      // Scenario 002 deep diagnostic: connection pool leak analysis
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            pool_config: {
              max_connections: 20,
              idle_timeout_ms: 30000,
              connection_timeout_ms: 2000,
            },
            current_state: {
              total_connections: 20,
              active_connections: 20,
              idle_connections: 0,
              waiting_requests: 47,
              saturation_percent: 100,
            },
            leaked_connections: [
              {
                connection_id: "conn_001",
                acquired_at: "2024-05-20T14:10:01Z",
                held_for_seconds: 185,
                last_query: "SELECT NOW()",
                acquired_by: "GET /break-pool handler at server.js:98",
                released: false,
                stack_trace: "at app.get('/break-pool') → pool.connect() called at server.js:107 → client.query('SELECT NOW()') at server.js:108 → NO client.release() CALL FOUND"
              },
              {
                connection_id: "conn_002",
                acquired_at: "2024-05-20T14:10:01Z",
                held_for_seconds: 185,
                last_query: "SELECT NOW()",
                acquired_by: "GET /break-pool handler at server.js:98",
                released: false,
                stack_trace: "at app.get('/break-pool') → pool.connect() called at server.js:107 → client.query('SELECT NOW()') at server.js:108 → NO client.release() CALL FOUND"
              },
            ],
            diagnosis: "All 20 connections acquired by GET /break-pool handler. None have been released. The handler calls pool.connect() and client.query() but NEVER calls client.release(). Connections accumulate until the pool is exhausted.",
            root_cause: "Missing client.release() call in GET /break-pool route handler in server.js. Every request acquires a connection but never returns it to the pool.",
            fix_hint: "Add client.release() in a try/finally block after the query call in the /break-pool handler."
          }, null, 2),
        }],
      };
    }

    case "get_retry_trace": {
      // Scenario 003 deep diagnostic: retry storm root cause
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            file: "server.js",
            handler: "GET /break-retry",
            line_range: "27–45",
            retry_config: {
              max_retries: 5,
              backoff_strategy: "NONE",
              delay_ms: 0,
              jitter: false,
            },
            execution_trace: [
              { attempt: 1, timestamp_offset_ms: 0,   error: "Downstream API Timeout: 503", delay_before_next_ms: 0 },
              { attempt: 2, timestamp_offset_ms: 102, error: "Downstream API Timeout: 503", delay_before_next_ms: 0 },
              { attempt: 3, timestamp_offset_ms: 204, error: "Downstream API Timeout: 503", delay_before_next_ms: 0 },
              { attempt: 4, timestamp_offset_ms: 306, error: "Downstream API Timeout: 503", delay_before_next_ms: 0 },
              { attempt: 5, timestamp_offset_ms: 408, error: "Downstream API Timeout: 503", delay_before_next_ms: 0 },
            ],
            thread_pool_impact: {
              concurrent_retry_storms: 128,
              active_threads: 128,
              max_threads: 128,
              queued_requests: 1203,
              saturation_percent: 100,
            },
            code_snippet: {
              file: "server.js",
              lines: "27-45",
              content: "for (let i = 0; i < MAX_RETRIES; i++) {\n  try {\n    await callDownstreamApi();\n  } catch (err) {\n    // BUG: NO await sleep() HERE — immediate retry\n  }\n}",
              missing_fix: "await new Promise(r => setTimeout(r, delay)) before each retry with exponential delay = Math.pow(2, attempt) * 100",
            },
            diagnosis: "The GET /break-retry handler in server.js retries a failing downstream API call 5 times with zero delay between attempts. Each concurrent request spawns its own tight retry loop, holding a thread open for ~500ms per storm. At high traffic volumes, 128 concurrent storms saturate the thread pool entirely, blocking all subsequent requests.",
            root_cause: "Missing exponential backoff delay in the retry for-loop in GET /break-retry handler at server.js:27-45. The loop calls callDownstreamApi() and catches errors but has no await sleep/delay before the next iteration.",
            fix_hint: "Inject exponential backoff: const delay = Math.pow(2, attempt) * 100; await new Promise(r => setTimeout(r, delay)); before the next loop iteration."
          }, null, 2),
        }],
      };
    }

    case "execute_sql": {
      const { query } = args;
      const connectionString = process.env.DATABASE_URL;

      if (!connectionString) {
        return {
          content: [{
            type: "text",
            text: "ERROR: DATABASE_URL environment variable is not set. Cannot connect to database.",
          }],
          isError: true,
        };
      }

      const pgClient = new PgClient({ connectionString, ssl: { rejectUnauthorized: false } });

      try {
        await pgClient.connect();
        console.error(`[execute_sql] Running query: ${query}`);
        const result = await pgClient.query(query);

        const rowCount = result.rowCount ?? 0;
        const command = result.command || "UNKNOWN";
        let responseText = `SQL executed successfully.\nCommand: ${command}\nRows affected: ${rowCount}`;

        // If SELECT-like query returned rows, include them
        if (result.rows && result.rows.length > 0) {
          responseText += `\nResult:\n${JSON.stringify(result.rows.slice(0, 50), null, 2)}`;
        }

        return {
          content: [{ type: "text", text: responseText }],
        };
      } catch (err) {
        console.error(`[execute_sql] Error: ${err.message}`);
        return {
          content: [{
            type: "text",
            text: `SQL execution failed.\nError: ${err.message}`,
          }],
          isError: true,
        };
      } finally {
        await pgClient.end().catch(() => {});
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

/**
 * Start Server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AutoSRE MCP Forensics Server v3.0 running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
