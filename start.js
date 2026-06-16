const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting AutoSRE Monorepo Launcher...');

let orchestratorProcess = null;
let targetAppProcess = null;

// Paths
const orchestratorPath = path.resolve(__dirname, 'backend/index.js');
const targetAppPath = path.resolve(__dirname, 'target-app/server.js');
const targetAppDir = path.dirname(targetAppPath);

// Helper to format logs
function pipeStream(processName, stream, outputStream = process.stdout) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer
    
    for (const line of lines) {
      let formattedLine = line;
      if (line.toLowerCase().includes("sandbox") || line.includes("✓ Connection pool") || line.includes("✓ Retry storm") || line.includes("✓ Query performance")) {
        // Wrap in bold yellow ANSI escape codes
        formattedLine = `\x1b[1m\x1b[33m${line}\x1b[0m`;
      }
      outputStream.write(`[${processName.toUpperCase()}] ${formattedLine}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer) {
      let formattedLine = buffer;
      if (buffer.toLowerCase().includes("sandbox") || buffer.includes("✓ Connection pool") || buffer.includes("✓ Retry storm") || buffer.includes("✓ Query performance")) {
        formattedLine = `\x1b[1m\x1b[33m${buffer}\x1b[0m`;
      }
      outputStream.write(`[${processName.toUpperCase()}] ${formattedLine}\n`);
    }
  });
}

// Spawn Orchestrator Backend
function startOrchestrator() {
  console.log(`[LAUNCHER] Starting Orchestrator Backend: node ${orchestratorPath}`);
  orchestratorProcess = spawn('node', [orchestratorPath], {
    cwd: path.dirname(orchestratorPath),
    env: { ...process.env, PORT: '3000' },
  });

  pipeStream('orchestrator', orchestratorProcess.stdout);
  pipeStream('orchestrator', orchestratorProcess.stderr, process.stderr);

  orchestratorProcess.on('close', (code) => {
    console.log(`[LAUNCHER] Orchestrator Process exited with code ${code}`);
  });
}

// Spawn Target Application
function startTargetApp() {
  console.log(`[LAUNCHER] Starting Target Application: node ${targetAppPath}`);
  targetAppProcess = spawn('node', [targetAppPath], {
    cwd: targetAppDir,
    env: { ...process.env, PORT: '3001' },
  });

  pipeStream('target-app', targetAppProcess.stdout);
  pipeStream('target-app', targetAppProcess.stderr, process.stderr);

  targetAppProcess.on('close', (code) => {
    console.log(`[LAUNCHER] Target App Process exited with code ${code}`);
  });
}

// Restart Target Application on file change
function restartTargetApp() {
  console.log('[DEPLOYER] New verified patch detected! Restarting target application...');
  if (targetAppProcess) {
    targetAppProcess.kill();
  }
  // Short delay to let the port release
  setTimeout(() => {
    startTargetApp();
  }, 500);
}

// Start both services
startOrchestrator();
startTargetApp();

// Watch target-app directory for changes to server.js (Debounced and Bulletproof)
let watchTimeout = null;
console.log(`[LAUNCHER] Watching target application code for patches at: ${targetAppPath}`);
fs.watch(targetAppDir, (eventType, filename) => {
  if (filename === 'server.js' && eventType === 'change') {
    if (watchTimeout) clearTimeout(watchTimeout);
    watchTimeout = setTimeout(() => {
      restartTargetApp();
    }, 100); // 100ms debounce to prevent double-firing
  }
});

// Clean up child processes on exit
process.on('SIGINT', () => {
  console.log('[LAUNCHER] Terminating all processes...');
  if (orchestratorProcess) orchestratorProcess.kill();
  if (targetAppProcess) targetAppProcess.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('[LAUNCHER] Terminating all processes...');
  if (orchestratorProcess) orchestratorProcess.kill();
  if (targetAppProcess) targetAppProcess.kill();
  process.exit();
});
