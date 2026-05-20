# process-monitoring

A lightweight HTTP server that monitors external processes and exposes their status as Prometheus metrics. Designed for shell scripts and cron jobs that need to report "I'm running" / "I'm done" / "I died" to a monitoring system.

## How it works

1. Your script calls `/api/started` with its PID and a name
2. The server tracks the process via `/proc/<pid>`
3. If the process exits cleanly, the script calls `/api/finished`
4. If the process dies unexpectedly, the server detects it within 30s via background polling
5. Prometheus scrapes `/metrics` — each end-state (finished/died) is reported **exactly once per scraper**, then cleaned up after 5 minutes

## Quick Start

```bash
npm install
node --env-file=.env index.js
```

## Usage in scripts

```bash
#!/bin/bash

# Register (--data-urlencode handles special characters in the name)
curl -s --get --data-urlencode "name=Backup $(hostname)" "http://localhost:5001/api/started?pid=$$"

# ... do work ...

# Finish (or skip this — the server detects death automatically)
curl -s "http://localhost:5001/api/finished?pid=$$"
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/started?pid=PID&name=NAME` | GET | Register a process for monitoring |
| `/api/finished?pid=PID` | GET | Mark a process as cleanly finished |
| `/metrics` | GET | Prometheus metrics endpoint |
| `/` | GET | Built-in documentation page |

## Prometheus Metrics

```
# TYPE process_monitoring gauge
process_monitoring{name="My Backup",status="running"}   1
process_monitoring{name="My Backup",status="finished"}   2
process_monitoring{name="My Backup",status="died"}        0
```

| Value | Status | Meaning |
|-------|--------|---------|
| `1` | `running` | Process is alive (verified via `/proc/<pid>`) |
| `2` | `finished` | Process called `/api/finished` — clean exit |
| `0` | `died` | Process disappeared without calling `/api/finished` |

End-states (`finished`/`died`) are reported **once per scraper**, not on every scrape. This prevents duplicate alerts when multiple Prometheus instances scrape the same endpoint. After 5 minutes, ended processes are cleaned up.

## Configuration

Via environment variables (or `.env` file with `--env-file=.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `METRIC_NAME` | `process_monitoring` | Prometheus metric name |
| `STATE_FILE` | `/tmp/process-monitor-state.json` | Path for persisting running processes across restarts |

## State Persistence

Running processes are saved to `STATE_FILE` on every register/finish event and on graceful shutdown (SIGTERM/SIGINT). On startup, the state is restored — so a restart of the monitor doesn't lose track of running processes.

The default path (`/tmp/`) survives service restarts but not system reboots, which is intentional: after a reboot, all tracked processes are dead anyway.

## Process Detection

The server checks if a process is still alive by testing for `/proc/<pid>`. This means:

- **Linux only** (relies on procfs)
- Detection delay for unexpected deaths: up to 30 seconds (background polling interval)
- The `/metrics` endpoint also checks on demand, so scraping triggers immediate detection

## Caveats

- **Local processes only.** The server verifies processes via `/proc/<pid>`, which only works for processes on the same machine. If a remote process registers itself (e.g. via `curl` from another host), the server won't find `/proc/<pid>` locally and will immediately report it as `died`. Each machine needs its own process-monitor instance.
- **Monitor restart while processes are running.** If a tracked process finishes cleanly while the monitor is down (e.g. during an update), the `/api/finished` call fails silently. After restart, the monitor loads the process as `running`, finds `/proc/<pid>` gone, and incorrectly reports `died` instead of `finished`.

## Deployment

### systemd user service

```ini
[Unit]
Description=Prometheus Process Monitor
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/Projects/process-monitoring
ExecStart=/usr/bin/node --env-file=.env index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

### Prometheus scrape config

```yaml
- job_name: "process-monitoring"
  scrape_interval: 10s
  static_configs:
    - targets: ["localhost:5001"]
```

## License

MIT
