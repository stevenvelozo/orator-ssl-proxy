# Quick Start

Get a working HTTPS reverse proxy in front of a real backend in under five minutes. This walkthrough uses the recommended **self-signed with local CA** strategy so your browser will trust the generated certificates after a one-time install.

## 1. Install

```bash
npm install orator-ssl-proxy
```

The module is self-contained — no peer dependencies on `orator` or `orator-serviceserver-restify`.

## 2. Start a Dummy Backend

For the walkthrough you need something listening for the proxy to forward to. A one-liner:

```bash
npx -y http-server -p 8086 .
```

This serves the current directory on `http://127.0.0.1:8086`. Anything works — a real app, a different port, a WebSocket server — the proxy doesn't care.

## 3. Write a Config File

Drop the following into `~/.orator-ssl.config.json`:

```json
{
    "certs":
    {
        "strategy": "selfsigned",
        "selfsigned": { "mode": "localCA" }
    },
    "routes":
        [
            { "host": "awesomeapp.localhost", "target": "http://127.0.0.1:8086" }
        ],
    "default":
    {
        "target": "http://127.0.0.1:8086"
    }
}
```

The `selfsigned` strategy with `mode: localCA` is the default, so you can omit those lines. They're shown here to make the recipe explicit.

## 4. Start the Proxy

```bash
npx orator-ssl-proxy serve
```

You should see output similar to:

```
==========================================================
  orator-ssl-proxy running
==========================================================
  HTTPS:      https://0.0.0.0:13711
  HTTP (80):  http://0.0.0.0:15233
  Strategy:   selfsigned
  Certs at:   /Users/you/.orator-ssl/certs
  Routes:     1 host-based
              awesomeapp.localhost → http://127.0.0.1:8086
  Default:    * → http://127.0.0.1:8086
==========================================================

  Press Ctrl+C to stop.
```

The hashed default ports land in the 13000-16999 range so nothing needs `sudo`. On first boot the proxy generates a 10-year local root CA at `~/.orator-ssl/certs/selfsigned/ca.cert` and signs a per-host leaf cert for `awesomeapp.localhost`.

## 5. Verify With `curl`

From another terminal:

```bash
# Pin the hostname to the loopback and skip cert verification for now
curl -k --resolve awesomeapp.localhost:13711:127.0.0.1 https://awesomeapp.localhost:13711/
```

You should see the dummy backend's response. The `-k` is only needed because your OS doesn't yet trust the local CA. Keep going.

## 6. Install the Local CA Root

Run the built-in installer:

```bash
npx orator-ssl-proxy cert-install-root-ca
```

It will:

1. Detect your platform (macOS / Ubuntu / Fedora / Arch / Windows).
2. Print the exact commands it's about to run.
3. Ask for confirmation.
4. Execute them (with `sudo` on Unix, UAC on Windows) to install the CA into your OS trust store.
5. Also install the CA into any detected Firefox NSS profiles (on any platform) if `certutil` is on `PATH`.

Pass `--print-only` to see the commands without running them, or `--yes` to skip the confirmation prompt.

## 7. Verify With Browser Trust

Drop the `-k` from your curl and point the browser at the same URL:

```bash
curl -v --cacert ~/.orator-ssl/certs/selfsigned/ca.cert \
    --resolve awesomeapp.localhost:13711:127.0.0.1 \
    https://awesomeapp.localhost:13711/
```

Expected: the cert chain validates cleanly, no `rejectUnauthorized` warning. Open `https://awesomeapp.localhost:13711/` in a browser — you should see the page with **no warning** on Chrome/Edge/Safari (Firefox too if `certutil` was available during the install step).

## 8. Add `awesomeapp.localhost` to Hosts (Optional)

`awesomeapp.localhost` is not a DNS-resolvable name on its own. Your browser may or may not resolve it depending on platform:

- **macOS / Linux** — `.localhost` names resolve to `127.0.0.1` automatically per RFC 6761 with most modern libc. If not, add it to `/etc/hosts`:

  ```bash
  echo "127.0.0.1 awesomeapp.localhost" | sudo tee -a /etc/hosts
  ```

- **Windows** — add it to `C:\Windows\System32\drivers\etc\hosts` (requires admin):

  ```
  127.0.0.1 awesomeapp.localhost
  ```

## 9. What to Explore Next

- [Architecture](architecture.md) — request lifecycle, SNI, renewal, and design trade-offs
- [Configuration Reference](configuration.md) — every option in the schema
- [Self-Signed with Local CA recipe](config-selfsigned-localca.md) — the configuration you just used, in full
- [Let's Encrypt recipe](config-letsencrypt.md) — when you're ready to move from dev to production
- [Local Dev That Just Works](local-dev-just-works.md) — the full flow for multi-service dev setups
- [CLI Reference](cli-reference.md) — every command and flag
