# Recipe: File-Based Certs

**Best for:** you already have PEM files — either from a commercial CA, an internal corporate CA, `mkcert`, `certbot`, or any other out-of-band process — and just need the proxy to load them.

The `file` strategy is the simplest possible: no generation, no renewal, no ACME. You supply paths to `key`, `cert`, and (optionally) `ca` PEMs in config, and the proxy loads them verbatim into the cert store.

## When to Use This

- You have commercial TLS certs from DigiCert, Sectigo, GoDaddy, etc.
- Your organization has its own internal CA and issues certs through an IT process
- You already run `certbot` (or another ACME client) out of process and want the proxy to just consume the resulting files
- You use `mkcert` for local dev and prefer its trust-install workflow over the built-in `localCA` mode
- You want to rotate certs from an external source without restarting the proxy (send `SIGHUP` to reload — see note below)

## When NOT to Use This

- You want the proxy to generate and manage certs automatically → use [Self-Signed Local CA](config-selfsigned-localca.md) or [Let's Encrypt](config-letsencrypt.md)

## Sample Configuration

### Single Default Cert (Usually Wildcard)

```json
{
    "https": { "port": 443 },
    "http":  { "port": 80, "redirectToHttps": true },
    "certs":
    {
        "strategy": "file",
        "file":
        {
            "default":
            {
                "key":  "/etc/ssl/private/wildcard.example.com.key",
                "cert": "/etc/ssl/certs/wildcard.example.com.crt",
                "ca":   "/etc/ssl/certs/ca-chain.pem"
            }
        }
    },
    "routes":
        [
            { "host": "app.example.com",   "target": "http://127.0.0.1:8086" },
            { "host": "files.example.com", "target": "http://127.0.0.1:9000" }
        ]
}
```

A single wildcard cert at `default` handles every host via SNI fallback. This is the most common case when you have one cert covering `*.example.com`.

### Per-Host Certs

```json
{
    "certs":
    {
        "strategy": "file",
        "file":
        {
            "default":
            {
                "key":  "/etc/ssl/private/default.key",
                "cert": "/etc/ssl/certs/default.crt"
            },
            "hosts":
                [
                    {
                        "host": "app.example.com",
                        "key":  "/etc/ssl/private/app.example.com.key",
                        "cert": "/etc/ssl/certs/app.example.com.crt"
                    },
                    {
                        "host": "api.example.com",
                        "key":  "/etc/ssl/private/api.example.com.key",
                        "cert": "/etc/ssl/certs/api.example.com.crt",
                        "ca":   "/etc/ssl/certs/internal-ca-chain.pem"
                    }
                ]
        }
    },
    "routes":
        [
            { "host": "app.example.com", "target": "http://127.0.0.1:8086" },
            { "host": "api.example.com", "target": "http://127.0.0.1:9100" }
        ]
}
```

Per-host entries are matched via SNI; any hostname not listed falls back to `default`.

## Commands

### Linux (Ubuntu) with Commercial Certs

```bash
# Install
sudo npm install -g orator-ssl-proxy

# Put your PEMs somewhere (convention: /etc/ssl/)
sudo cp app.example.com.crt /etc/ssl/certs/
sudo cp app.example.com.key /etc/ssl/private/
sudo chmod 600 /etc/ssl/private/app.example.com.key

# Write the config
sudo tee /etc/orator-ssl/orator-ssl.config.json <<'EOF'
{
    "https": { "port": 443 },
    "http":  { "port": 80, "redirectToHttps": true },
    "certs":
    {
        "strategy": "file",
        "file":
        {
            "default":
            {
                "key":  "/etc/ssl/private/app.example.com.key",
                "cert": "/etc/ssl/certs/app.example.com.crt"
            }
        }
    },
    "routes":
        [
            { "host": "app.example.com", "target": "http://127.0.0.1:8086" }
        ]
}
EOF

# Start (needs root for 443/80 unless you set cap_net_bind_service)
sudo orator-ssl-proxy serve --config /etc/orator-ssl/orator-ssl.config.json
```

### macOS with `mkcert`-Generated Certs

If you prefer `mkcert`'s trust-install workflow:

```bash
# Install mkcert (one time)
brew install mkcert nss
mkcert -install

# Generate a cert for a couple of hostnames
cd ~/certs
mkcert app.localhost files.localhost

# Install the proxy
npm install -g orator-ssl-proxy

# Config pointing at the mkcert files
cat > ~/.orator-ssl.config.json <<'EOF'
{
    "certs":
    {
        "strategy": "file",
        "file":
        {
            "default":
            {
                "key":  "/Users/me/certs/app.localhost+1-key.pem",
                "cert": "/Users/me/certs/app.localhost+1.pem"
            }
        }
    },
    "routes":
        [
            { "host": "app.localhost",   "target": "http://127.0.0.1:8086" },
            { "host": "files.localhost", "target": "http://127.0.0.1:9000" }
        ]
}
EOF

# Start
orator-ssl-proxy serve

# mkcert already installed its root CA into your system trust store
# so browsers trust these certs with no extra steps.
curl --resolve app.localhost:13711:127.0.0.1 https://app.localhost:13711/
```

### Combining with External `certbot`

If you already run `certbot` (standalone or via a package) out of process and want to feed its output to the proxy:

```bash
# certbot writes to /etc/letsencrypt/live/<domain>/ by convention:
#   privkey.pem      → key
#   fullchain.pem    → cert (includes the intermediate chain)
#   chain.pem        → ca (the intermediate chain alone, optional)

sudo tee /etc/orator-ssl/orator-ssl.config.json <<'EOF'
{
    "https": { "port": 443 },
    "http":  { "port": 80, "redirectToHttps": true },
    "certs":
    {
        "strategy": "file",
        "file":
        {
            "hosts":
                [
                    {
                        "host": "app.example.com",
                        "key":  "/etc/letsencrypt/live/app.example.com/privkey.pem",
                        "cert": "/etc/letsencrypt/live/app.example.com/fullchain.pem"
                    }
                ]
        }
    },
    "routes":
        [
            { "host": "app.example.com", "target": "http://127.0.0.1:8086" }
        ]
}
EOF

# certbot handles renewal via its own cron / timer
# You just need to reload the proxy when the files change — see below.
```

## Reloading After a Certbot Renewal

The `file` strategy reads its PEMs once at boot. If you renew them out of process, the proxy won't see the new files until it reloads. For now, the simplest approach is to restart the service after a `certbot renew`:

```bash
# systemd
sudo systemctl restart orator-ssl-proxy

# launchd (macOS)
sudo launchctl kickstart -k system/com.retold.oratorsslproxy
```

A future version will support `SIGHUP` for in-place cert reload without dropping existing connections. Track the roadmap item in the [architecture doc](architecture.md#design-trade-offs).

## PEM Format Notes

- **`key`** — PEM-encoded private key. Usually `-----BEGIN PRIVATE KEY-----` or `-----BEGIN RSA PRIVATE KEY-----`. Encrypted keys are not supported; decrypt them once with `openssl rsa -in encrypted.key -out plain.key` before pointing the proxy at them.
- **`cert`** — PEM-encoded certificate. If your commercial CA provides a separate intermediate chain file, you can either point `ca` at it or concatenate the leaf + intermediates into `cert` (most clients handle either). Let's Encrypt's `fullchain.pem` already includes the intermediates.
- **`ca`** — Optional. Use this when the cert is signed by a private CA your clients don't trust out of the box. The CA PEM is concatenated with the leaf cert when building the TLS `SecureContext`, so clients that know the CA can build the chain.

## Troubleshooting

**`ENOENT: no such file or directory, open '/etc/ssl/private/app.example.com.key'`.**
Path typo or permissions issue. Confirm the file exists and is readable by the user running the proxy.

**`Error: error:0909006C:PEM routines:get_name:no start line`.**
The file at that path isn't a valid PEM. Check you're not accidentally pointing at a DER-encoded `.cer` (convert with `openssl x509 -inform der -in file.cer -out file.pem`).

**Browser trusts the cert in curl but not in the browser.**
Double-check the cert's SAN list includes the exact hostname you're requesting, and that you're presenting the full chain (either concatenated into `cert` or supplied via `ca`).

**Proxy starts but TLS handshake fails with `wrong version number`.**
You're probably pointing at the key file as the cert or vice versa. Swap them.
