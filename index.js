import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 5001;

const storage = new Map();

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
      await execAsync(`kill -0 ${pid}`);
      return true;
    } catch {
      return false;
    }
  }
}

app.get('/api/started', (req, res) => {
  const { name, pid, computer } = req.query;

  if (!name || !pid || !computer) {
    return res.status(400).json({ error: 'Missing required parameters: name, pid, computer' });
  }

  storage.set(pid, { name, computer, pid });
  res.json({ success: true, message: 'Process registered' });
});

app.get('/api/finished', (req, res) => {
  const { pid } = req.query;

  if (!pid) {
    return res.status(400).json({ error: 'Missing required parameter: pid' });
  }

  const deleted = storage.delete(pid);
  res.json({ success: deleted, message: deleted ? 'Process removed' : 'Process not found' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', 'text/plain');

  let metrics = '# TYPE process_monitoring gauge\n';

  for (const [pid, data] of storage.entries()) {
    const running = await isProcessRunning(pid);
    const status = running ? 'running' : 'died';
    metrics += `process_monitoring{computer="${data.computer}",name="${data.name}",status="${status}"} 1\n`;

    if (!running) {
      storage.delete(pid);
    }
  }

  res.send(metrics);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
