import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { access, constants } from 'fs/promises';

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

const storage = new Map();

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
        <code>GET /api/started?pid=$$&name=NAME</code>
        <p>Registers a process for monitoring.</p>
        <p><strong>Parameters:</strong></p>
        <ul>
          <li><code>name</code> - Process name</li>
          <li><code>pid</code> - Process ID</li>
        </ul>
      </div>

      <div class="endpoint">
        <h3>Unregister Process</h3>
        <code>GET /api/finished?pid=$$</code>
        <p>Removes a process from monitoring.</p>
        <p><strong>Parameters:</strong></p>
        <ul>
          <li><code>pid</code> - Process ID</li>
        </ul>
      </div>

      <div class="endpoint">
        <h3>Prometheus Metrics</h3>
        <code>GET /metrics</code>
        <p>Returns Prometheus-formatted metrics. Checks if each registered process is still running.</p>
        <p><strong>Metric format:</strong></p>
        <pre>process_monitoring{name="NAME",status="running"} 1
process_monitoring{name="NAME",status="died"} 0</pre>
        <p><strong>Note:</strong> Processes with status "died" are automatically removed from storage after being reported.</p>
      </div>
    </body>
    </html>
  `);
});

async function isProcessRunning(pid) {
  if (process.platform === 'win32') {
    try {
      await execAsync(`tasklist /FI "PID eq ${pid}"`);
      return true;
    } catch {
      return false;
    }
  } else {
    try {
      await access(`/proc/${pid}`, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

app.get('/api/started', (req, res) => {
  const { name, pid } = req.query;

  if (!name || !pid) {
    return res.status(400).json({ error: 'Missing required parameters: name, pid' });
  }

  storage.set(pid, {
    name,
    pid,
    createdAt: Date.now(),
    reportedCounter: 0,
    finished: false
  });
  res.json({ success: true, message: 'Process registered' });
});

app.get('/api/finished', (req, res) => {
  const { pid } = req.query;

  if (!pid) {
    return res.status(400).json({ error: 'Missing required parameter: pid' });
  }

  const process = storage.get(pid);

  if (!process) {
    return res.json({ success: false, message: 'Process not found' });
  }

  if (process.reportedCounter === 0) {
    process.finished = true;
    storage.set(pid, process);
    res.json({ success: true, message: 'Process marked as finished' });
  } else {
    storage.delete(pid);
    res.json({ success: true, message: 'Process removed' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', 'text/plain');

  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  let metrics = '# TYPE process_monitoring gauge\n';

  for (const [pid, data] of storage.entries()) {
    const shouldOutput = !data.finished || (data.finished && data.createdAt >= oneMinuteAgo);

    if (shouldOutput) {
      const running = data.finished || await isProcessRunning(pid);
      const status = data.finished ? 'finished' : running ? 'running' : 'died';
      const value = running ? 1 : 0;
      metrics += `process_monitoring{name="${data.name}",status="${status}"} ${value}\n`;

      data.reportedCounter++;
      storage.set(pid, data);
    }
  }

  for (const [pid, data] of storage.entries()) {
    if (data.finished) {
      storage.delete(pid);
    }
  }

  res.send(metrics);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
