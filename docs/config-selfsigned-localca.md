# Recipe: Self-Signed with Local CA

**Best for:** local development, home networks, internal tools on a trusted LAN.

This is the default strategy. The proxy generates a persistent 10-year local root CA on first boot, signs per-host leaf certs from it, and stores everything under `~/.orator-ssl/certs/selfsigned/`. You install the CA root into your OS trust store **once** (via `cert-install-root-ca`) and every subsequent leaf cert — now or in the future, for any hostname — is automatically trusted by browsers.

## When to Use This

- You want real browser trust (no yellow address bar) without registering a public domain
- You're running services on `.localhost`, `.test`, `.internal`, or any other non-public name
- You manage a personal or internal device fleet and don't want to reinstall certs every year
- You want to share the same trust root across multiple dev machines (export the CA once, install on each)

## When NOT to Use This

- You're serving traffic from the public internet → use [Let's Encrypt](config-letsencrypt.md)
- You already have PEMs issued by a trusted CA (commercial or internal) → use [File-Based Certs](config-file-certs.md)
- You only need to run a single `curl` command and don't care about browser warnings → use [Self-Signed Ad-Hoc](config-selfsigned-adhoc.md)

## Sample Configuration

Save this as `~/.orator-ssl.config.json`:

```json
{
    "https": { "host": "0.0.0.0" },
    "http":  { "redirectToHttps": true },
    "certs":
    {
        "strategy": "selfsigned",
        "storagePath": "~/.orator-ssl/certs",
        "selfsigned":
        {
            "mode": "localCA",
            "caCommonName": "My Dev Local CA",
            "caValidityYears": 10,
            "leafValidityDays": 365,
            "keySize": 2048
        }
    },
    "routes":
        [
            { "host": "awesomeapp.localhost", "target": "http://127.0.0.1:8086" },
            { "host": "dashboard.localhost",  "target": "http://127.0.0.1:8087" },
            { "host": "api.localhost",        "target": "http://127.0.0.1:8088" }
        ],
    "default":
    {
        "target": "http://127.0.0.1:8080"
    },
    "logging": { "level": "info", "accessLog": true }
}
```

Every field under `certs.selfsigned` is optional and shown for clarity. The minimum viable config is just:

```json
{
    "certs": { "strategy": "selfsigned" },
    "routes": [{ "host": "awesomeapp.localhost", "target": "http://127.0.0.1:8086" }]
}
```

## Commands

### macOS

```bash
# Install the package (one-time)
npm install -g orator-ssl-proxy

# Drop the config file
mkdir -p ~
cat > ~/.orator-ssl.config.json <<'EOF'
{
    "certs": { "strategy": "selfsigned" },
    "routes": [{ "host": "awesomeapp.localhost", "target": "http://127.0.0.1:8086" }],
    "default": { "target": "http://127.0.0.1:8080" }
}
EOF

# Start the proxy in the background (no sudo needed — hashed high ports)
orator-ssl-proxy serve &

# Install the generated CA into the macOS System Keychain (requires sudo)
orator-ssl-proxy cert-install-root-ca

# Verify the chain
curl -v --cacert ~/.orator-ssl/certs/selfsigned/ca.cert \
    --resolve awesomeapp.localhost:13711:127.0.0.1 \
    https://awesomeapp.localhost:13711/
```

Open `https://awesomeapp.localhost:13711/` in Chrome, Safari, or Edge — no cert warning.

To stop:

```bash
pkill -f 'orator-ssl-proxy serve'
```

### Linux (Ubuntu, Debian, Fedora, Arch)

```bash
# Install the package
npm install -g orator-ssl-proxy

# (Optional on Debian/Ubuntu) install libnss3-tools so the installer can
# also add the CA to any Firefox profiles automatically:
sudo apt-get install -y libnss3-tools

# Drop the config file
cat > ~/.orator-ssl.config.json <<'EOF'
{
    "certs": { "strategy": "selfsigned" },
    "routes": [{ "host": "awesomeapp.localhost", "target": "http://127.0.0.1:8086" }],
    "default": { "target": "http://127.0.0.1:8080" }
}
EOF

# Start the proxy in the background
orator-ssl-proxy serve &

# Install the generated CA into the system trust store (requires sudo)
orator-ssl-proxy cert-install-root-ca

# Verify
curl -v --cacert ~/.orator-ssl/certs/selfsigned/ca.cert \
    --resolve awesomeapp.localhost:13711:127.0.0.1 \
    https://awesomeapp.localhost:13711/
```

The installer detects Debian/Ubuntu vs Fedora/RHEL vs Arch automatically and runs the appropriate `update-ca-certificates`, `update-ca-trust`, or `trust extract-compat` command.

## Cert Lifecycle

- **CA root** lives at `~/.orator-ssl/certs/selfsigned/ca.{key,cert,meta.json}`. Generated once, reused forever, 10-year validity. A warning is logged when it enters the last 10% of its lifetime.
- **Leaf certs** live at `~/.orator-ssl/certs/selfsigned/{hostname}.{key,cert,meta.json}`. 1-year validity, regenerated automatically on the next boot after they fall within 30 days of expiry. No user intervention required.
- The chain presented during TLS handshakes is `leaf + CA`, so clients that already trust the CA can build a complete chain in one round trip.

## Sharing the CA Across Machines

```bash
# On the machine where the CA was generated:
orator-ssl-proxy cert-export-root-ca ~/Desktop/my-dev-ca.cert

# Transfer ~/Desktop/my-dev-ca.cert to the other machine (AirDrop, scp, email, ...)

# On the second machine:
orator-ssl-proxy cert-install-root-ca --print-only   # see the install commands
```

Then run the printed commands manually, or copy the CA into `~/.orator-ssl/certs/selfsigned/ca.cert` (plus the `.key` if you want to sign leaves from the second machine) and run `orator-ssl-proxy cert-install-root-ca` normally.

## Rotating the CA

The CA is not rotated automatically — replacing it would invalidate trust on every device it's been installed on. To rotate manually:

```bash
# Stop the proxy first
pkill -f 'orator-ssl-proxy serve'

# Remove the CA from your trust store (keeps the files on disk)
orator-ssl-proxy cert-uninstall-root-ca

# Purge the files
orator-ssl-proxy cert-uninstall-root-ca --purge

# Restart the proxy — it will generate a fresh CA on first boot
orator-ssl-proxy serve &

# Install the new CA
orator-ssl-proxy cert-install-root-ca
```

Repeat the trust-install step on every other device that was using the old CA.

## Troubleshooting

**Browser still shows a warning after `cert-install-root-ca`.**
Restart the browser — most browsers cache the trust store at process start. Firefox may need `libnss3-tools` installed so the installer can add the CA to its own NSS database separately from the OS store.

**`curl: (60) SSL certificate problem` even with `--cacert`.**
Double-check you're pointing at the `ca.cert` file (not `ca.key` or a leaf), and that the hostname you're requesting matches a SAN in the served leaf cert. Run `orator-ssl-proxy cert-show` to list all loaded certs and their expiry dates.

**`EACCES` when installing on Linux.**
The installer uses `sudo` for the system commands (copying to `/usr/local/share/ca-certificates/`, running `update-ca-certificates`, etc.). Make sure your user is in the sudoers file, or run `orator-ssl-proxy cert-install-root-ca --print-only` and copy-paste the commands into a root shell yourself.

**Firefox doesn't trust the CA on Linux.**
Firefox uses its own NSS store, not the system one. Install `libnss3-tools` and re-run `cert-install-root-ca` — the installer will detect your Firefox profiles and add the CA to each one via `certutil`.
