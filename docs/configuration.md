# Configuration Reference

Orator SSL Proxy reads configuration from three sources, merged in priority order:

1. **CLI flags** (highest priority) -- `--https-port`, `--http-port`, `--certs-path`, `--self-signed`, `--staging`
2. **Configuration file**, loaded automatically by `pict-service-commandlineutility` from (in order):
   - `~/.orator-ssl.config.json`
   - `./.orator-ssl.config.json`
   - `./.config/.orator-ssl.config.json`
3. **Built-in defaults** (lowest priority) -- see `source/Orator-SSL-Proxy-Default-Configuration.js`

When embedding the service provider in a Fable app, pass the configuration object directly:

```javascript
_Fable.serviceManager.instantiateServiceProvider('OratorSSLProxy',
    {
        Configuration: { /* full or partial config */ }
    });
```

The loader deep-merges user values over defaults, expands `~` in paths, resolves `null` ports to hashed defaults, normalises route entries, and validates the final shape. Validation failures throw with a human-readable list of errors.

## Top-Level Shape

```json
{
    "https": { },
    "http":  { },
    "certs": { },
    "routes": [ ],
    "default": { },
    "logging": { }
}
```

## `https` -- HTTPS Listener

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `https.port` | integer or `null` | hashed default | Port to listen on. `null` resolves to a deterministic port in 13000-14999 derived from the package name. `0` means "let the OS pick" (useful for tests). |
| `https.host` | string | `"0.0.0.0"` | Address to bind. `"127.0.0.1"` for loopback-only; `"0.0.0.0"` to accept from any interface. |
| `https.minVersion` | string | `"TLSv1.2"` | Minimum TLS version. Passed through to `tls.createSecureContext`. Accepts `"TLSv1"`, `"TLSv1.1"`, `"TLSv1.2"`, `"TLSv1.3"`. |
| `https.ciphers` | string or `null` | `null` | Cipher suite list, OpenSSL-format. `null` uses Node's default. |

## `http` -- Port 80 Companion Listener

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `http.port` | integer or `null` | hashed default | Plain HTTP listen port. Used for ACME HTTP-01 challenges and optional HTTPS redirects. `null` resolves to a deterministic port in 15000-16999. |
| `http.host` | string | `"0.0.0.0"` | Address to bind. |
| `http.redirectToHttps` | boolean | `true` | Redirect all non-ACME requests to `https://<host><url>`. Set `false` for ACME-only mode (rare). |

The port-80 listener only binds when either `redirectToHttps` is `true` **or** the cert strategy is `letsencrypt` (which needs port 80 for HTTP-01 challenges).

## `certs` -- Certificate Management

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `certs.strategy` | string | `"selfsigned"` | Which cert strategy to use: `"selfsigned"`, `"letsencrypt"`, or `"file"`. |
| `certs.storagePath` | string | `"~/.orator-ssl/certs"` | Root directory for persistent cert storage. `~` is expanded. Docker images default this to `/certs`. |
| `certs.hostnames` | array of strings | `[]` | Extra hostnames to provision certs for beyond what's listed in `routes`. Useful when you want a cert for the default fall-through host. |

### `certs.selfsigned`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `certs.selfsigned.mode` | string | `"localCA"` | `"localCA"` (persistent local CA signing leaves -- recommended) or `"adhoc"` (one-off standalone self-signed, browser will always warn). |
| `certs.selfsigned.caCommonName` | string | `"Retold Orator SSL Proxy Local CA"` | Subject CN for the generated root CA. Shown in browser trust dialogs. |
| `certs.selfsigned.caOrganization` | string | `"Retold"` | Subject organization for the generated root CA. |
| `certs.selfsigned.caValidityYears` | integer | `10` | CA root validity in years. |
| `certs.selfsigned.leafValidityDays` | integer | `365` | Per-host leaf cert validity in days. Leaves within 30 days of expiry are automatically reissued. |
| `certs.selfsigned.keySize` | integer | `2048` | RSA key size in bits. `2048` or `4096`. |

### `certs.letsencrypt`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `certs.letsencrypt.email` | string | *(required)* | Contact email registered with the ACME account. Let's Encrypt uses this for expiry notifications. |
| `certs.letsencrypt.staging` | boolean | `true` | Use Let's Encrypt staging directory. Flip to `false` for production, but only after confirming the flow in staging -- production has rate limits (50 certs / registered domain / week). |
| `certs.letsencrypt.directoryUrl` | string or `null` | `null` | Override the ACME directory URL. When set, overrides `staging`. Useful for third-party ACME providers or internal test servers. |
| `certs.letsencrypt.renewBeforeDays` | integer | `30` | Re-issue any cert within this many days of expiry. |
| `certs.letsencrypt.renewCheckIntervalHours` | integer | `12` | How often the background timer runs `checkAndRenew()`. |
| `certs.letsencrypt.bootstrapWithSelfSigned` | boolean | `true` | Serve a self-signed placeholder during first-issuance (30-60s) so the HTTPS port is available. |

### `certs.file`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `certs.file.default.key` | string or `null` | `null` | Path to a default key PEM (SNI fallback). |
| `certs.file.default.cert` | string or `null` | `null` | Path to a default cert PEM. |
| `certs.file.default.ca` | string or `null` | `null` | Path to a CA chain PEM to concatenate with the cert for clients that need the full chain. |
| `certs.file.hosts` | array | `[]` | Per-host overrides. Each entry: `{ host, key, cert, ca }`. |

## `routes` -- Host-Based Routing Table

Each entry is an object:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | *(required)* | Exact hostname (`app.example.com`) or wildcard pattern (`*.example.com`). Lowercased at load time. |
| `target` | string | *(required)* | Backend URL to forward matching requests to. Include the scheme and port: `"http://127.0.0.1:8086"`. |
| `ws` | boolean | `true` | Forward WebSocket upgrades for this route. Set `false` to deny WS for a specific backend. |
| `xfwd` | boolean | `true` | Inject `X-Forwarded-For`, `X-Forwarded-Proto: https`, and `X-Forwarded-Host` headers. |
| `httpProxyOptions` | object | `{}` | Additional options passed through to `http-proxy` for this route. Merged with the defaults. |

Exact matches are tried before wildcards, and wildcards are sorted longest-suffix-first so the most specific pattern wins. `*.dev.example.com` beats `*.example.com` for `foo.dev.example.com`.

Wildcard certs are **not** automatically issued for wildcard route patterns. Let's Encrypt wildcard certs require DNS-01 challenges, which are out of scope for v1. List concrete hostnames in `certs.hostnames` if you need them.

## `default` -- Fall-Through Route

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default.target` | string or `null` | `null` | Backend URL for requests whose `Host` header doesn't match any entry in `routes`. If `null`, unmatched requests get a 502 with a clear error body. |

A proxy with no routes **and** no `default.target` is rejected at validation time. It can't serve anything.

## `logging`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logging.level` | string | `"info"` | Minimum log level. `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`. |
| `logging.accessLog` | boolean | `true` | Emit per-request access log lines for each incoming HTTPS and port-80 request. |

## CLI Flag Overrides

When running `orator-ssl-proxy serve`, the following CLI flags override the loaded configuration:

| Flag | Overrides |
|------|-----------|
| `-c, --config [path]` | Skip the auto-loader chain and use this file exclusively |
| `--https-port [port]` | `https.port` |
| `--http-port [port]` | `http.port` |
| `--certs-path [path]` | `certs.storagePath` |
| `--self-signed` | Forces `certs.strategy` to `"selfsigned"` |
| `--staging` | Forces `certs.letsencrypt.staging` to `true` |
| `-l, --logfile [path]` | Adds a file logger alongside console output |

## Example Configurations

### Minimal (Local Dev with Self-Signed Local CA)

```json
{
    "certs": { "strategy": "selfsigned" },
    "routes":
        [
            { "host": "awesomeapp.localhost", "target": "http://127.0.0.1:8086" }
        ],
    "default": { "target": "http://127.0.0.1:8080" }
}
```

### Multiple Backends + Wildcard

```json
{
    "certs":
    {
        "strategy": "selfsigned",
        "hostnames": ["dashboard.localhost", "files.localhost", "api.localhost"]
    },
    "routes":
        [
            { "host": "dashboard.localhost", "target": "http://127.0.0.1:8086" },
            { "host": "files.localhost",     "target": "http://127.0.0.1:9000" },
            { "host": "api.localhost",       "target": "http://127.0.0.1:9100" },
            { "host": "*.dev.localhost",     "target": "http://127.0.0.1:9200" }
        ],
    "default": { "target": "http://127.0.0.1:8080" }
}
```

### Let's Encrypt (Production)

```json
{
    "https": { "port": 443 },
    "http":  { "port": 80, "redirectToHttps": true },
    "certs":
    {
        "strategy": "letsencrypt",
        "storagePath": "/var/lib/orator-ssl",
        "letsencrypt":
        {
            "email": "admin@example.com",
            "staging": false
        }
    },
    "routes":
        [
            { "host": "app.example.com",   "target": "http://127.0.0.1:8086" },
            { "host": "files.example.com", "target": "http://127.0.0.1:9000" }
        ]
}
```

### Bring Your Own PEMs

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
                "key": "/etc/ssl/private/wildcard.example.com.key",
                "cert": "/etc/ssl/certs/wildcard.example.com.crt",
                "ca": "/etc/ssl/certs/ca-chain.pem"
            }
        }
    },
    "routes":
        [
            { "host": "app.example.com", "target": "http://127.0.0.1:8086" }
        ]
}
```

## Explain Your Current Configuration

Run the auto-generated mixin command to dump every configurable key with its current resolved value:

```bash
npx orator-ssl-proxy explain-config
```

This comes for free from `pict-service-commandlineutility`'s `AutoAddConfigurationExplanationCommand` feature.
