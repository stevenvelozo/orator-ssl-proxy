# Recipe: Self-Signed Ad-Hoc

**Best for:** throwaway certs for curl / automation, CI smoke tests, internal tooling where no browser ever touches the endpoint.

This mode generates a stand-alone self-signed cert per hostname, with no local CA in the mix. Every cert is self-issued and self-signed, so browsers will **always** show a "Not Secure" warning. Use this when you don't care about browser trust and just need TLS to be on.

## When to Use This

- You're only calling the endpoint from scripts and can pass `curl -k` or `rejectUnauthorized: false`
- You want zero on-disk state beyond a single key/cert per host
- You're running ephemeral containers where persistent CA state is pointless
- You're testing TLS plumbing itself and need cheap, throwaway certs

## When NOT to Use This

- Any browser will ever hit these endpoints → use [Self-Signed with Local CA](config-selfsigned-localca.md)
- You need trusted public certs → use [Let's Encrypt](config-letsencrypt.md)

## Sample Configuration

```json
{
    "https": { "host": "0.0.0.0" },
    "http":  { "redirectToHttps": false },
    "certs":
    {
        "strategy": "selfsigned",
        "selfsigned":
        {
            "mode": "adhoc",
            "leafValidityDays": 30,
            "keySize": 2048
        }
    },
    "routes":
        [
            { "host": "ci.internal",   "target": "http://127.0.0.1:9100" },
            { "host": "test.internal", "target": "http://127.0.0.1:9101" }
        ],
    "default":
    {
        "target": "http://127.0.0.1:9100"
    }
}
```

Ad-hoc certs are regenerated automatically once they fall within 30 days of expiry, same as the local-CA leaves.

## Commands

### macOS

```bash
# Install the package
npm install -g orator-ssl-proxy

# Config
cat > ~/.orator-ssl.config.json <<'EOF'
{
    "certs":
    {
        "strategy": "selfsigned",
        "selfsigned": { "mode": "adhoc", "leafValidityDays": 30 }
    },
    "routes": [{ "host": "ci.internal", "target": "http://127.0.0.1:9100" }]
}
EOF

# Start
orator-ssl-proxy serve &

# Hit it with curl (use -k to skip verification)
curl -k --resolve ci.internal:13711:127.0.0.1 https://ci.internal:13711/status
```

### Linux

Identical to macOS except for the typical `apt`/`yum` package install for Node. All the orator-ssl-proxy commands are the same:

```bash
# Install the package (requires Node 18+)
sudo apt-get install -y nodejs npm    # or: sudo dnf install -y nodejs
npm install -g orator-ssl-proxy

# Config
cat > ~/.orator-ssl.config.json <<'EOF'
{
    "certs":
    {
        "strategy": "selfsigned",
        "selfsigned": { "mode": "adhoc", "leafValidityDays": 30 }
    },
    "routes": [{ "host": "ci.internal", "target": "http://127.0.0.1:9100" }]
}
EOF

# Start
orator-ssl-proxy serve &

# Hit it with curl
curl -k --resolve ci.internal:13711:127.0.0.1 https://ci.internal:13711/status
```

## Scripting Against the Proxy

The proxy's port is deterministic — you can query it at startup and plug it into your scripts:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Start the proxy in the background and remember the PID
orator-ssl-proxy serve > /tmp/proxy.log 2>&1 &
PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null || true" EXIT

# Wait for the HTTPS port to open
HTTPS_PORT=13711
for i in $(seq 1 30); do
    if nc -z 127.0.0.1 $HTTPS_PORT 2>/dev/null; then
        break
    fi
    sleep 0.2
done

# Run smoke tests against each configured backend
curl -ksf --resolve ci.internal:${HTTPS_PORT}:127.0.0.1 https://ci.internal:${HTTPS_PORT}/healthz
curl -ksf --resolve ci.internal:${HTTPS_PORT}:127.0.0.1 https://ci.internal:${HTTPS_PORT}/metrics
```

## Trade-Offs

| Property | Ad-Hoc | Local CA |
|----------|--------|----------|
| Browser trust | Never (warning every time) | Yes (after one-time install) |
| Persistent on-disk state | Just per-host leaves | Root CA + per-host leaves |
| Setup steps | `serve` | `serve` + `cert-install-root-ca` |
| Needs `sudo` | No | Yes (for OS trust install) |
| Works in ephemeral containers | Yes | Only if `/certs` is mounted |
| Survives browser restart across host regen | No (always untrusted) | Yes |

If there's any doubt, start with [Self-Signed with Local CA](config-selfsigned-localca.md) — it's strictly more useful and the extra one-time install takes 30 seconds.
