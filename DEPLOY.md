# Deploying ArenaHub (single box)

This covers standing up the whole stack — mediamtx (SRT ingest, HLS/WebRTC
serving) plus the ArenaHub backend and frontend — on one fresh Ubuntu box
for a new venue or truck.

## Prerequisites

- Ubuntu 22.04+ (or similar), root access
- Node.js 18+ already installed (`node --version`) — the installer builds
  the frontend but won't install Node itself; see
  [nodesource](https://github.com/nodesource/distributions) if you need it
- This repo cloned to the box (default assumed location: `/opt/arena`)
- An encoder somewhere that can publish SRT to this box on port 8890 (see
  the Arena-Stream repo's `arena_stream` — the Electron app or CLI binary)

## Install

```bash
cd /opt/arena
sudo bash install.sh <this-box's-ip>
```

`<this-box's-ip>` is whatever address viewers and your encoder will actually
reach this box at (public IP for a cloud box, LAN IP for an on-prem/truck
setup). It's baked into mediamtx's WebRTC config so ICE candidates resolve
correctly — get this wrong and WebRTC preview/watch pages won't connect
even though HLS still works.

This installs mediamtx (binary + config + systemd unit), the Python venv +
backend, builds the frontend, generates a `.env` (random JWT secret, blank
SRT passphrase), and starts both `mediamtx` and `arena` as systemd
services. Re-running it is safe — it won't overwrite an existing `.env` or
re-download mediamtx if already installed.

**This script has not yet been run against a genuinely fresh box end to
end** — it's built from the existing manual process (`deploy.sh`,
`restore-mediamtx.sh`) plus a full read of what those assumed already
existed. Watch its output the first time you run it, and check
`journalctl -u arena` / `journalctl -u mediamtx` if either service reports
a failure at the end.

## After install — do these before going live

1. **Set an SRT passphrase.** The installer leaves
   `SRT_PUBLISH_PASSPHRASE` blank in `.env`, meaning anyone who can reach
   port 8890 can publish a stream under any name. Pick a 10-79 character
   passphrase, set it in `.env`, then `systemctl restart arena` — it's
   applied to mediamtx automatically on startup.
2. **Change the default admin password** (`admin` / `admin123`) — Settings
   → Users, or via the API.
3. **Open firewall ports** if the box has one active:
   - `8001/tcp` — dashboard
   - `8890/udp` — SRT ingest (encoder → box)
   - `8889/tcp+udp` — WebRTC (viewer ↔ box)
   - `8888/tcp` — HLS (viewer ← box)
   - `9997/tcp` — mediamtx API — LAN-only is fine, this doesn't need to be
     internet-reachable
4. **Set an alert webhook** (optional) — `ALERT_WEBHOOK_URL` in `.env`, a
   Slack-compatible incoming webhook, so stream-down/threshold alerts
   actually reach someone instead of only `journalctl`.
5. **Configure recording retention** (optional) — Settings → Recording, if
   you want old recordings auto-deleted once storage passes a limit.

## Already set up automatically

- **Database backups** — `arena.db` (users, alert rules, redundancy
  gateway configs, recording index) is backed up daily to `backups/` next
  to it, keeping the last 7. Trigger one manually anytime with
  `POST /api/settings/backup` (admin only) — useful right before a risky
  change. Doesn't cover recordings themselves (the actual video files),
  just this metadata.
- **Login brute-force protection** — 5 failed logins from the same source
  within 15 minutes locks that source out for 15 minutes.

## What the installer does NOT set up

- **`arena-srt-relay.service`** — only needed if your source sends
  uncompressed PCM audio over a separate SRT port for AAC transcoding
  (`srt-audio-relay.sh`, hardcoded to a `Golf_Channel` stream name by
  default, override via `STREAM_NAME` env). Most setups won't need this;
  if you do, install it manually:
  ```bash
  cp arena-srt-relay.service /etc/systemd/system/
  systemctl daemon-reload && systemctl enable --now arena-srt-relay
  ```
- **TLS/HTTPS** — the dashboard and mediamtx both serve plain HTTP. Put a
  reverse proxy (Caddy, nginx) in front if you need TLS; none of this
  stack requires it to function on a LAN or over a VPN.
- **Redundancy gateways** (SMPTE 2022-7 dual-path failover, `sdi_receive`
  from the Arena-Stream repo) — a separate binary you run near the decode
  box if you need protected/redundant paths. Register its `--stats-port`
  endpoint under Alerts → Redundancy gateways once it's running.

## Operational scripts (already in the repo, for an existing install)

- `restore-mediamtx.sh` — resets `/etc/mediamtx.yml` to the known-good
  config and restarts both services. Useful if mediamtx's config gets into
  a bad state from manual edits.
- `fix-mediamtx.sh` — patches specific known issues into an existing
  config in place (native HLS muxer settings, custom path hooks).
- `status.sh`, `diag.sh`, `diag-audio.sh` — read-only diagnostics.

## Updating an existing install

```bash
cd /opt/arena
git pull
# Backend-only change:
systemctl restart arena
# Frontend change:
cd frontend && npm ci && npm run build && cd ..
systemctl restart arena
```
