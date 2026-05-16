import express from 'express';
import { access, constants, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const METRIC_NAME = process.env.METRIC_NAME || 'process_monitoring';
const STALE_TIMEOUT = 300000; // 5 minutes
const STATE_FILE = process.env.STATE_FILE || '/tmp/process-monitor-state.json';

const storage = new Map();

async function saveState() {
  const entries = [];
  for (const [pid, data] of storage.entries()) {
    if (!data.endedAt) {
      entries.push([pid, data]);
    }
  }
  try {
    await writeFile(STATE_FILE, JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to save state:', e.message);
  }
}

async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const entries = JSON.parse(raw);
    for (const [pid, data] of entries) {
      storage.set(pid, data);
    }
    console.log(`Loaded ${entries.length} processes from state file`);
  } catch {
    // No state file or invalid — start fresh
  }
}

// Load state on startup
await loadState();

async function isProcessRunning(pid) {
  try {
    await access(`/proc/${pid}`, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function markDied(pid, data) {
  if (!data.endedAt) {
    data.endedAt = Date.now();
    data.status = 'died';
    storage.set(pid, data);
  }
}

// Background check every 30s
setInterval(async () => {
  for (const [pid, data] of storage.entries()) {
    if (!data.endedAt && !await isProcessRunning(pid)) {
      markDied(pid, data);
    }
  }
}, 30000);

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Process Monitoring Server</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        h2 { color: #666; margin-top: 30px; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
        pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
        .endpoint { margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>Process Monitoring Server</h1>
      <p>This server provides process monitoring with Prometheus metrics.</p>

      <h2>API Endpoints</h2>

      <div class="endpoint">
        <h3>Register Process</h3>
        <code>GET /api/started?pid=$$&amp;name=NAME</code>
        <p>Registers a process for monitoring.</p>
      </div>

      <div class="endpoint">
        <h3>Unregister Process</h3>
        <code>GET /api/finished?pid=$$</code>
        <p>Marks a process as cleanly finished.</p>
      </div>

      <div class="endpoint">
        <h3>Prometheus Metrics</h3>
        <code>GET /metrics</code>
        <p>Returns Prometheus-formatted metrics.</p>
        <pre>${METRIC_NAME}{name="NAME",status="running"}  1
${METRIC_NAME}{name="NAME",status="died"}     0
${METRIC_NAME}{name="NAME",status="finished"} 2</pre>
      </div>
    </body>
    </html>
  `);
});

app.get('/api/started', async (req, res) => {
  const { name, pid } = req.query;

  if (!name || !pid) {
    return res.status(400).json({ error: 'Missing required parameters: name, pid' });
  }

  storage.set(pid, {
    name,
    pid,
    createdAt: Date.now(),
    endedAt: null,
    status: 'running',
    reported: false
  });
  await saveState();
  res.json({ success: true, message: 'Process registered' });
});

app.get('/api/finished', async (req, res) => {
  const { pid } = req.query;

  if (!pid) {
    return res.status(400).json({ error: 'Missing required parameter: pid' });
  }

  const proc = storage.get(pid);

  if (!proc) {
    return res.json({ success: false, message: 'Process not found' });
  }

  proc.endedAt = Date.now();
  proc.status = 'finished';
  storage.set(pid, proc);
  await saveState();
  res.json({ success: true, message: 'Process marked as finished' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', 'text/plain');

  const now = Date.now();
  let metrics = `# TYPE ${METRIC_NAME} gauge\n`;

  for (const [pid, data] of storage.entries()) {
    // Check alive (in addition to background timer)
    if (!data.endedAt && !await isProcessRunning(pid)) {
      markDied(pid, data);
    }

    if (data.endedAt) {
      // Ended process: report once, then clean up.
      if (data.reported) {
        // Already reported — delete if stale, otherwise skip
        if (now - data.endedAt > STALE_TIMEOUT) {
          storage.delete(pid);
        }
        continue;
      }
      const value = data.status === 'finished' ? 2 : 0;
      metrics += `${METRIC_NAME}{name="${data.name}",status="${data.status}"} ${value}\n`;
      data.reported = true;
    } else {
      // Running
      metrics += `${METRIC_NAME}{name="${data.name}",status="running"} 1\n`;
    }
  }

  res.send(metrics);
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown: save state before exit
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`${sig} received, saving state...`);
    await saveState();
    server.close(() => process.exit(0));
  });
}
