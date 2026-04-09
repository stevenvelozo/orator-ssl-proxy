# Local Dev That Just Works

This guide walks you through the end-to-end setup for a local dev experience where HTTPS "just works" — real browser trust, sensible hostnames, WebSocket support, no `sudo`, and no per-service cert fiddling. Once set up, every service you add later slots into the same proxy with no new cert work.

The setup has four one-time steps (15 minutes total) and one per-project step (30 seconds).

## The End Result

When you're done, you'll be able to:

- Run `orator-ssl-proxy serve` once in a background terminal and leave it there
- Hit `https://app-a.localhost:13711/`, `https://app-b.localhost:13711/`, `https://api.localhost:13711/`, etc. in any browser on your machine with no cert warnings
- Route each of those to a different local backend by editing one config file
- Add new services later by adding one line to the config and one entry to `/etc/hosts` (or equivalent)
- Share the CA across multiple dev machines so your team gets the same "just works" behavior
- Even have your phone or tablet trust the dev certs (see [iOS install guide](install-ca-ios.md))

## Prerequisites

- Node.js 20 or later
- Any of: macOS, Ubuntu / Debian / Fedora / Arch, Windows 10 or 11

## One-Time Setup

### Step 1: Install orator-ssl-proxy

```bash
# macOS / Linux
npm install -g orator-ssl-proxy

# Windows (PowerShell)
npm install -g orator-ssl-proxy
```

### Step 2: Write a Config File

Save the following as `~/.orator-ssl.config.json` (on Windows, `%USERPROFILE%\.orator-ssl.config.json`):

```json
{
    "certs":
    {
        "strategy": "selfsigned",
        "hostnames":
            [
                "app-a.localhost",
                "app-b.localhost",
                "dashboard.localhost",
                "api.localhost",
                "files.localhost"
            ]
    },
    "routes":
        [
            { "host": "app-a.localhost",     "target": "http://127.0.0.1:8086" },
            { "host": "app-b.localhost",     "target": "http://127.0.0.1:8087" },
            { "host": "dashboard.localhost", "target": "http://127.0.0.1:8088" },
            { "host": "api.localhost",       "target": "http://127.0.0.1:8089" },
            { "host": "files.localhost",     "target": "http://127.0.0.1:9000" }
        ],
    "default":
    {
        "target": "http://127.0.0.1:8080"
    },
    "logging": { "level": "info", "accessLog": true }
}
```

The `certs.hostnames` list ensures the proxy pre-provisions certs for every hostname you use, even if you don't have a backend running for it yet. It's fine to list more hosts than you currently use — the proxy just generates extra leaf certs from the same CA.

### Step 3: Start the Proxy Once to Generate the CA

```bash
orator-ssl-proxy serve &
```

Wait for the output showing the HTTPS port (typically `13711`), then Ctrl+C or leave it running. On first boot the proxy will generate `~/.orator-ssl/certs/selfsigned/ca.cert` and per-host leaf certs for everything in your routes list.

### Step 4: Install the Local CA

```bash
orator-ssl-proxy cert-install-root-ca
```

Follow the prompts. This is the only `sudo`-requiring step in the whole process, and it only happens once per machine.

Platform-specific details:

- **macOS** — see [install-ca-mac.md](install-ca-mac.md)
- **Windows 10/11** — see [install-ca-windows.md](install-ca-windows.md)
- **Ubuntu / Debian / Fedora / Arch** — see [install-ca-ubuntu.md](install-ca-ubuntu.md)
- **iPhone / iPad** (to trust the CA on mobile) — see [install-ca-ios.md](install-ca-ios.md)

**Restart your browsers** after the install completes. They cache the trust store at launch.

### Step 5: (Optional) Add Hostnames to Your Hosts File

Most modern OSes resolve `*.localhost` to `127.0.0.1` automatically per RFC 6761. If yours doesn't, add the hostnames manually.

**macOS / Linux:**

```bash
sudo tee -a /etc/hosts <<'EOF'
127.0.0.1 app-a.localhost app-b.localhost dashboard.localhost api.localhost files.localhost
EOF
```

**Windows (PowerShell as Administrator):**

```powershell
Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" `
    -Value "`n127.0.0.1 app-a.localhost app-b.localhost dashboard.localhost api.localhost files.localhost"
```

Skip this step first — most people don't need it. If a browser can't resolve `app-a.localhost`, come back and do it.

## Daily Use

Start the proxy in a background terminal and leave it there:

```bash
orator-ssl-proxy serve
```

You'll see something like:

```
==========================================================
  orator-ssl-proxy running
==========================================================
  HTTPS:      https://0.0.0.0:13711
  HTTP (80):  http://0.0.0.0:15233
  Strategy:   selfsigned
  Certs at:   /Users/you/.orator-ssl/certs
  Routes:     5 host-based
              app-a.localhost → http://127.0.0.1:8086
              app-b.localhost → http://127.0.0.1:8087
              dashboard.localhost → http://127.0.0.1:8088
              api.localhost → http://127.0.0.1:8089
              files.localhost → http://127.0.0.1:9000
  Default:    * → http://127.0.0.1:8080
==========================================================

  Press Ctrl+C to stop.
```

Then start whatever backend services you're working on, on the matching ports. Open `https://app-a.localhost:13711/` in your browser. Done.

## Adding a New Service

When you start working on a new service, you usually want it behind HTTPS too. The flow is one line of config plus (maybe) one line of hosts:

1. **Pick a hostname.** Convention: `<servicename>.localhost`.
2. **Pick a port.** Any free port your backend will bind. If you use `npx quack`, your backend already picks a deterministic hashed port automatically.
3. **Edit `~/.orator-ssl.config.json`** and add the host to `certs.hostnames` and the route:

   ```json
   "certs": { "hostnames": ["app-a.localhost", "..., "newservice.localhost"] },
   "routes": [
       ...,
       { "host": "newservice.localhost", "target": "http://127.0.0.1:8090" }
   ]
   ```

4. **Restart the proxy** (Ctrl+C, `orator-ssl-proxy serve` again). First restart will issue a new leaf cert for `newservice.localhost` — trusted automatically because the CA is already in your OS trust store.
5. **Hit it** at `https://newservice.localhost:13711/`.

No `sudo`, no cert generation, no browser warnings. Add a line, restart, go.

## Bonus: WebSocket Support

All routes forward WebSocket `upgrade` events automatically. If your app uses `wss://newservice.localhost:13711/ws` for live updates, it just works — the proxy routes the upgrade to your backend's HTTP WebSocket endpoint. You don't need to configure anything WebSocket-specific.

If you want to explicitly disable WebSockets for a route, add `"ws": false`:

```json
{ "host": "api.localhost", "target": "http://127.0.0.1:8089", "ws": false }
```

## Bonus: Sharing With Teammates

To give a teammate the same dev environment without them re-installing a new random CA:

```bash
# On your machine:
orator-ssl-proxy cert-export-root-ca ~/Desktop/team-dev-ca.cert

# Also share the CA private key if you want them to be able to sign leaves
# for their own hosts locally. (If you only share the cert, they can still
# trust your CA but can't issue new leaves — the proxy on their machine
# will generate its own CA separately.)
cp ~/.orator-ssl/certs/selfsigned/ca.key ~/Desktop/team-dev-ca.key

# Transfer both files to the teammate's machine
```

On the teammate's machine:

```bash
# Before running the proxy for the first time, drop the shared CA files in place
mkdir -p ~/.orator-ssl/certs/selfsigned
cp /path/to/team-dev-ca.cert ~/.orator-ssl/certs/selfsigned/ca.cert
cp /path/to/team-dev-ca.key  ~/.orator-ssl/certs/selfsigned/ca.key

# Now run the usual install — cert-install-root-ca will use the existing CA
orator-ssl-proxy cert-install-root-ca
```

Everyone on the team now shares one CA. Certs issued by any teammate are trusted by every other teammate without an extra install.

**Security note:** the CA private key is a credential. Anyone with it can issue certs that your browsers will trust. Don't put it on an untrusted machine, don't commit it to a public git repo, and treat it like you'd treat any other private key.

## Bonus: Phone and Tablet

To hit the dev proxy from your phone on the same LAN:

1. **Bind the proxy to `0.0.0.0`** (the default) so it accepts connections from other hosts on your LAN.
2. **Give your dev machine a stable IP** (DHCP reservation or static) — say `192.168.1.100`.
3. **Add a fake hostname → IP mapping** that your phone can resolve. Easiest: if your router supports local DNS, add `dev.lan → 192.168.1.100`. Or just hit the raw IP: `https://192.168.1.100:13711/` (but your cert's SAN must include `192.168.1.100` — add it to `certs.hostnames` in the config, or just use the IP as a route entry).
4. **Install the CA on the phone** — see [install-ca-ios.md](install-ca-ios.md). All four steps, don't skip the trust toggle.
5. Open `https://dev.lan:13711/` on the phone. Cert trusted, no warning, backend reachable.

## Troubleshooting

**`orator-ssl-proxy serve` says `EACCES: permission denied` on bind.**
You're trying to bind port 443 or 80 as a regular user. Don't — let the proxy pick hashed high ports. Remove any `--https-port 443` / `--http-port 80` from your command, or remove the explicit `https.port` / `http.port` from your config file.

**`orator-ssl-proxy serve` says `EADDRINUSE` on the hashed port.**
Something else is already listening on that port. Find what with `lsof -iTCP:13711 -sTCP:LISTEN` (macOS/Linux) or `netstat -ano | findstr :13711` (Windows). Kill it or pick a different port with `--https-port <n>`.

**Browser says `DNS_PROBE_FINISHED_NXDOMAIN` for `*.localhost` hostnames.**
Your OS isn't resolving `.localhost` to loopback automatically. Add the hostnames to `/etc/hosts` (Step 5 above).

**Chrome works but Firefox warns about the cert.**
Firefox uses its own NSS trust store. On Linux, install `libnss3-tools` and re-run `cert-install-root-ca`. On macOS, install `brew install nss` and re-run. On Windows, import the cert manually through Firefox's Certificate Manager — see [install-ca-windows.md](install-ca-windows.md#firefox-setup).

**Backend works directly on `http://127.0.0.1:8086` but gives 502 through the proxy.**
The proxy is running but can't reach the backend. Most common cause: the backend bound to a specific interface (like `127.0.0.1` only) and the proxy's forwarded request is arriving from a different interface. Make sure your backend binds `127.0.0.1` or `0.0.0.0` and that the route `target` matches.

**Added a new hostname but the proxy still returns 502.**
You forgot to restart the proxy after editing the config. Ctrl+C and `orator-ssl-proxy serve` again. (A future version will support `SIGHUP` for config reload.)
