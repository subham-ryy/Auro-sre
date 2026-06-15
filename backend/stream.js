const EventEmitter = require('events');
const agentEmitter = new EventEmitter();

function sseHandler(req, res) {
  // Required headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // CRITICAL: Prevent Render's Nginx proxy from buffering the stream
  // Without this, the frontend won't see messages until the buffer fills or the connection closes.
  res.setHeader('X-Accel-Buffering', 'no');

  res.flushHeaders();

  // Keep connection alive with comments
  const keepAlive = setInterval(() => {
    res.write(':\n\n');
  }, 15000);

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'system', message: 'SSE connection established' })}\n\n`);

  // Listener for agent events
  const onAgentMessage = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  agentEmitter.on('agent_message', onAgentMessage);

  req.on('close', () => {
    clearInterval(keepAlive);
    agentEmitter.off('agent_message', onAgentMessage);
    res.end();
  });
}

// Helper to broadcast messages easily from other files
function broadcast(type, payload) {
  agentEmitter.emit('agent_message', { type, payload, timestamp: Date.now() });
}

module.exports = { sseHandler, broadcast };
