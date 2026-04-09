# Recipe: Let's Encrypt

**Best for:** production, or any deployment on a publicly-resolvable DNS name where you want free, auto-renewing, publicly-trusted certificates.

This strategy uses the [`acme-client`](https://github.com/publishlab/node-acme-client) npm package to complete Let's Encrypt's ACME v2 HTTP-01 challenge. A background timer re-checks expiry every 12 hours and reissues certs within 30 days of expiry automatically — no cron, no certbot wrapper, no systemd units required.

## Requirements

1. **Publicly resolvable DNS names.** Every hostname in your routes table (that you want certs for) must resolve to the machine running the proxy.
2. **Port 80 reachable from the public internet.** Let's Encrypt's HTTP-01 challenge hits `http://<host>/.well-known/acme-challenge/<token>` during issuance. You cannot change the port and you cannot use DNS-01 in v1 (see [DNS-01 and Wildcards](#dns-01-and-wildcards) below).
3. **Port 443 also reachable.** Obvious, but worth stating: clients need to connect to the HTTPS port to actually use the proxy.
4. **Persistent storage for `{storagePath}/letsencrypt/`.** The ACME account key and issued certs live here. Losing this directory forces a fresh account registration and reissuance, which counts against production rate limits.

## Rate Limits (Read This First)

Let's Encrypt production has a rate limit of **50 certificates per registered domain per week**, plus a **duplicate certificate limit of 5 per week per exact set of names**. Blasting `orator-ssl-proxy serve` against production Let's Encrypt during development will hit these limits fast and lock you out for a week.

**Always test in staging first.** The module defaults to staging (`certs.letsencrypt.staging: true`); leave it there until you've confirmed the flow works end to end. Only set `staging: false` once you're sure.

Staging certs are issued by `(STAGING) Let's Encrypt` and are **not** trusted by browsers. You should see the staging issuer name in `openssl s_client` output — that confirms you're hitting staging.

## Sample Configuration

```json
{
    "https": { "port": 443, "host": "0.0.0.0" },
    "http":  { "port": 80, "host": "0.0.0.0", "redirectToHttps": true },
    "certs":
    {
        "strategy": "letsencrypt",
        "storagePath": "/var/lib/orator-ssl",
        "letsencrypt":
        {
            "email": "admin@example.com",
            "staging": true,
            "renewBeforeDays": 30,
            "renewCheckIntervalHours": 12,
            "bootstrapWithSelfSigned": true
        }
    },
    "routes":
        [
            { "host": "app.example.com",   "target": "http://127.0.0.1:8086" },
            { "host": "files.example.com", "target": "http://127.0.0.1:9000" },
            { "host": "api.example.com",   "target": "http://127.0.0.1:9100" }
        ]
}
```

## Commands

### Linux (Ubuntu) — Recommended for Production

Running on any cloud VM or home server with a public IP:

```bash
# 1. Install Node 20+ (required)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install the proxy
sudo npm install -g orator-ssl-proxy

# 3. Create the storage dir and config
sudo mkdir -p /var/lib/orator-ssl /etc/orator-ssl
sudo chown -R "$USER:$USER" /var/lib/orator-ssl /etc/orator-ssl

sudo tee /etc/orator-ssl/orator-ssl.config.json <<'EOF'
{
    "https": { "port": 443, "host": "0.0.0.0" },
    "http":  { "port": 80, "host": "0.0.0.0", "redirectToHttps": true },
    "certs":
    {
        "strategy": "letsencrypt",
        "storagePath": "/var/lib/orator-ssl",
        "letsencrypt":
        {
            "email": "admin@example.com",
            "staging": true
        }
    },
    "routes":
        [
            { "host": "app.example.com", "target": "http://127.0.0.1:8086" }
        ]
}
EOF

# 4. Point your DNS A record at the server's public IP
#    app.example.com → 203.0.113.10

# 5. Allow ports 80 and 443 through the firewall (if applicable)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 6. Start the proxy (needs root to bind 443/80)
sudo node /usr/lib/node_modules/orator-ssl-proxy/source/cli/OratorSSLProxy-CLI-Run.js \
    serve --config /etc/orator-ssl/orator-ssl.config.json

# Alternative: give Node the cap_net_bind_service capability and run as a regular user
sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))
orator-ssl-proxy serve --config /etc/orator-ssl/orator-ssl.config.json

# 7. Verify the chain with openssl — expect issuer "(STAGING) Let's Encrypt"
openssl s_client -connect app.example.com:443 -servername app.example.com < /dev/null 2>/dev/null \
    | openssl x509 -noout -issuer -subject -dates

# 8. Once staging looks good, edit the config to set staging: false and restart.
```

For a long-running production deployment, wrap the `orator-ssl-proxy serve` command in a systemd unit so it restarts automatically on failure.

### Production systemd Unit

Save as `/etc/systemd/system/orator-ssl-proxy.service`:

```ini
[Unit]
Description=Orator SSL Proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=orator-ssl
Group=orator-ssl
Environment=NODE_ENV=production
ExecStart=/usr/bin/orator-ssl-proxy serve --config /etc/orator-ssl/orator-ssl.config.json
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo useradd --system --home /var/lib/orator-ssl --shell /usr/sbin/nologin orator-ssl
sudo chown -R orator-ssl:orator-ssl /var/lib/orator-ssl
sudo systemctl daemon-reload
sudo systemctl enable --now orator-ssl-proxy
sudo systemctl status orator-ssl-proxy
sudo journalctl -u orator-ssl-proxy -f
```

### macOS (Development or Home Server)

Running on a Mac mini at home with port forwarding from your router:

```bash
# 1. Install Node 20+ via Homebrew
brew install node

# 2. Install the proxy
npm install -g orator-ssl-proxy

# 3. Create storage and config directories
sudo mkdir -p /var/lib/orator-ssl /etc/orator-ssl
sudo chown -R "$USER:staff" /var/lib/orator-ssl /etc/orator-ssl

cat > /etc/orator-ssl/orator-ssl.config.json <<'EOF'
{
    "https": { "port": 443, "host": "0.0.0.0" },
    "http":  { "port": 80, "host": "0.0.0.0", "redirectToHttps": true },
    "certs":
    {
        "strategy": "letsencrypt",
        "storagePath": "/var/lib/orator-ssl",
        "letsencrypt":
        {
            "email": "admin@example.com",
            "staging": true
        }
    },
    "routes":
        [
            { "host": "app.example.com", "target": "http://127.0.0.1:8086" }
        ]
}
EOF

# 4. Make sure ports 80 and 443 are forwarded from your router to this Mac

# 5. Start the proxy (sudo needed to bind 443/80 on macOS)
sudo orator-ssl-proxy serve --config /etc/orator-ssl/orator-ssl.config.json

# 6. Verify
openssl s_client -connect app.example.com:443 -servername app.example.com < /dev/null 2>/dev/null \
    | openssl x509 -noout -issuer -subject -dates

# 7. Flip staging: false in the config once the staging flow works, then restart
```

For a long-running Mac deployment, create a launchd plist at `/Library/LaunchDaemons/com.retold.oratorsslproxy.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.retold.oratorsslproxy</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/orator-ssl-proxy</string>
        <string>serve</string>
        <string>--config</string>
        <string>/etc/orator-ssl/orator-ssl.config.json</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/orator-ssl-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/orator-ssl-proxy.log</string>
</dict>
</plist>
```

Then:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.retold.oratorsslproxy.plist
sudo launchctl list | grep oratorsslproxy
tail -f /var/log/orator-ssl-proxy.log
```

## First-Boot Bootstrap Window

During first issuance (30-60 seconds), the proxy needs to be listening on port 443 to serve requests from real clients, but it doesn't yet have a real cert. The `bootstrapWithSelfSigned: true` option (default `true`) handles this by seeding the cert store with a 1-day placeholder self-signed cert so the HTTPS listener can bind. Clients hitting the port during this window will see a cert warning. After `client.auto()` completes, the placeholder is replaced with the real Let's Encrypt cert **without restarting the socket**.

Set `bootstrapWithSelfSigned: false` if you'd rather refuse connections during bootstrap.

## Renewal

A `setInterval` runs every `renewCheckIntervalHours` (default 12) and calls `strategy.checkAndRenew()`. Any cert within `renewBeforeDays` days of expiry (default 30) is reissued. Successful renewals update the in-memory cert store, so new TLS handshakes pick up the new cert immediately — no restart required.

If renewal fails (e.g., Let's Encrypt is down), the failure is logged and the next interval tries again. You have 30 days of margin.

To force an immediate check without restarting:

```bash
orator-ssl-proxy cert-renew
```

This runs one renewal cycle against the live storage directory and exits.

## DNS-01 and Wildcards

HTTP-01 cannot issue wildcard certs (`*.example.com`). Let's Encrypt only supports wildcards via DNS-01, which requires DNS-provider-specific API integration. DNS-01 is **out of scope for v1** of this module. If you need wildcards, you have two options:

1. **List every hostname explicitly** in both `routes` and `certs.hostnames`. Let's Encrypt will issue one cert per host. This is what most people end up doing.
2. **Issue wildcards out-of-band** (e.g., with `certbot` and a DNS plugin) and point the `file` strategy at the resulting PEMs. See [File-Based Certs](config-file-certs.md).

## Troubleshooting

**`challenge did not pass: urn:ietf:params:acme:error:dns` during `client.auto()`.**
Your DNS is not resolving the hostname to this server's public IP. Confirm with `dig app.example.com @1.1.1.1`. Wait for DNS propagation before retrying.

**`Fetching http://<host>/.well-known/acme-challenge/...: Timeout` in Let's Encrypt logs.**
Port 80 is not reachable from the public internet. Check firewall rules (`ufw status`, cloud security groups), port forwarding on your router, and any upstream proxy that might be intercepting port 80.

**Staging works but production returns `too many certificates` / `too many failed authorizations`.**
You hit a rate limit. Wait a week or switch to a different domain. Production rate limits are documented at https://letsencrypt.org/docs/rate-limits/.

**`EACCES: permission denied, open '/var/lib/orator-ssl/letsencrypt/account.key'`.**
The user running the proxy can't write to the storage directory. Either `chown -R` the directory to that user or run the proxy as root (in production, prefer `chown` plus `AmbientCapabilities=CAP_NET_BIND_SERVICE` in systemd).

**Certs aren't being renewed and I can see the old ones on disk.**
Check the logs for errors during `checkAndRenew()` runs. Confirm the storage path is persistent across restarts (critical for Docker). Run `orator-ssl-proxy cert-renew` manually and watch the output — any error there will tell you what's wrong.
