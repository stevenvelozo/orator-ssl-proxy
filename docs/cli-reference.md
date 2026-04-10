# CLI Reference

The `orator-ssl-proxy` CLI is built on `pict-service-commandlineutility`, so it inherits the framework's behaviors for free: multi-folder config loading, an `explain-config` mixin command, and standard `--help` output.

## Synopsis

```bash
orator-ssl-proxy [command] [options]
ossl           [command] [options]   # short alias
```

The `ossl` alias is set in the module's `package.json` `bin` field alongside `orator-ssl-proxy`.

## Commands

| Command | Purpose |
|---------|---------|
| [`serve`](#serve) | Start the SSL-terminating reverse proxy |
| [`docker-build`](#docker-build) | Build the shipped Docker image |
| [`docker-run`](#docker-run) | Run the shipped Docker image with appropriate mounts |
| [`cert-show`](#cert-show) | List currently-stored certs and their expiry dates |
| [`cert-renew`](#cert-renew) | Run one renewal cycle without starting the server |
| [`cert-install-root-ca`](#cert-install-root-ca) | Install the local CA into the OS trust store |
| [`cert-uninstall-root-ca`](#cert-uninstall-root-ca) | Remove the local CA from the OS trust store |
| [`cert-export-root-ca`](#cert-export-root-ca) | Export the local CA for transfer to another device |
| [`explain-config`](#explain-config) | Dump every configurable key with its resolved value |

## Global Behavior

- **Config auto-loading** -- every command reads a `.orator-ssl.config.json` from `~`, `./`, and `./.config/` in that order, deep-merged. No `-c` flag required unless you want to override the chain.
- **Help** -- `orator-ssl-proxy [command] --help` for per-command flags, `orator-ssl-proxy --help` for the command list.
- **Version** -- `orator-ssl-proxy -v` or `--version` prints the package version.

---

## `serve`

Start the SSL-terminating reverse proxy listening locally. This is the command you'll run most.

### Usage

```bash
orator-ssl-proxy serve [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --config [path]` | -- | Path to an explicit config file. Bypasses the auto-loader chain. |
| `--https-port [port]` | hashed default | Override `https.port` from config. |
| `--http-port [port]` | hashed default | Override `http.port` from config. |
| `--certs-path [path]` | `~/.orator-ssl/certs` | Override `certs.storagePath`. |
| `--self-signed` | -- | Force `certs.strategy` to `"selfsigned"`, ignoring the config file. |
| `--staging` | -- | Force `certs.letsencrypt.staging` to `true`. |
| `-l, --logfile [path]` | -- | Write logs to a file alongside console output. If `path` is omitted, auto-generates a timestamped name. |

### Examples

```bash
# Start with whatever's in ~/.orator-ssl.config.json
orator-ssl-proxy serve

# Use a specific config file
orator-ssl-proxy serve --config /etc/orator-ssl/production.json

# Override ports for a one-off test
orator-ssl-proxy serve --https-port 8443 --http-port 8080

# Force self-signed mode for local dev regardless of what the config says
orator-ssl-proxy serve --self-signed

# Log to a file as well as the console
orator-ssl-proxy serve -l ~/logs/orator-ssl.log
```

### Signals

- **SIGINT / SIGTERM** -- triggers graceful shutdown: stops the renewal timer, closes the HTTPS and HTTP servers, and releases the `http-proxy` instance. Exit code 0.

---

## `docker-build`

Build the shipped Docker image from the module root. Shells out to `docker build`.

### Usage

```bash
orator-ssl-proxy docker-build [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-t, --tag [tag]` | `orator-ssl-proxy:local` | Image tag to build. |
| `-f, --file [dockerfile]` | `Dockerfile` | Dockerfile path, relative to the module root. |
| `--no-cache` | -- | Pass `--no-cache` to `docker build`. |

### Examples

```bash
# Standard build
orator-ssl-proxy docker-build

# Custom tag
orator-ssl-proxy docker-build --tag myorg/orator-ssl-proxy:v1.0.0

# Clean rebuild
orator-ssl-proxy docker-build --no-cache
```

---

## `docker-run`

Run the Docker image with standard port and volume mounts. Shells out to `docker run`.

### Usage

```bash
orator-ssl-proxy docker-run [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-t, --tag [tag]` | `orator-ssl-proxy:local` | Image tag to run. |
| `--https-port [port]` | `443` | Host port to bind to the container's 443. |
| `--http-port [port]` | `80` | Host port to bind to the container's 80. |
| `--config-path [path]` | `~/.orator-ssl.config.json` | Host path to mount as `/config/.orator-ssl.config.json` (read-only). |
| `--certs-path [path]` | `~/.orator-ssl/certs` | Host path to mount as `/certs` (persistent). |
| `--name [name]` | `orator-ssl-proxy` | Container name. |
| `-d, --detach` | -- | Run detached in the background. |

### Examples

```bash
# Standard run (foreground, standard ports)
orator-ssl-proxy docker-run

# Detached with custom ports for dev
orator-ssl-proxy docker-run --detach --https-port 8443 --http-port 8080

# Custom config and certs paths
orator-ssl-proxy docker-run \
    --config-path /etc/orator-ssl/production.json \
    --certs-path /var/lib/orator-ssl
```

---

## `cert-show`

List every cert currently stored on disk, with expiry dates, without starting the server. Useful for ops and debugging.

### Usage

```bash
orator-ssl-proxy cert-show [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--hostname [host]` | -- | Only show the entry for this hostname. |

### Example Output

```
=== selfsigned @ /Users/me/.orator-ssl/certs/selfsigned ===
  CA        expires 2036-04-09T15:01:12.000Z (3652 days)
  alpha.localhost                expires 2027-04-09T15:01:12.851Z (365 days)
  beta.localhost                 expires 2027-04-09T15:01:12.953Z (365 days)
```

---

## `cert-renew`

Run one renewal cycle for the currently-configured strategy, without starting the full server. Useful for scheduled jobs or manual top-ups.

### Usage

```bash
orator-ssl-proxy cert-renew
```

### What It Does

Loads the config, instantiates the strategy, and calls `checkAndRenew()` once. Certs within the renewal window are reissued and persisted to disk. The command exits when the cycle completes (or fails). It does **not** signal a running `serve` process to reload -- in a production deployment you'd typically want `cert-renew` followed by a `systemctl restart orator-ssl-proxy` (or equivalent) to pick up the new certs.

For the `letsencrypt` strategy specifically, a long-running `serve` process already checks for renewals every 12 hours by default, so you rarely need to call this manually.

---

## `cert-install-root-ca`

Install the local CA (generated by the `selfsigned` strategy) into the OS trust store so browsers trust every leaf cert the proxy issues.

### Usage

```bash
orator-ssl-proxy cert-install-root-ca [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--print-only` | -- | Only print the commands that would run, without executing them. |
| `--yes` | -- | Skip the confirmation prompt and run immediately. |

### What It Does

1. Ensures the local CA exists. If not, generates one on the spot.
2. Detects the platform (macOS / Linux-debian / Linux-fedora / Linux-arch / Windows).
3. Builds a plan of commands to run (copy CA file, run `update-ca-certificates`, etc.).
4. Also detects any Firefox profiles and adds `certutil` commands for each, if `certutil` is on PATH.
5. Prints the plan and, unless `--yes`, asks for confirmation.
6. Runs the commands with `stdio: 'inherit'` so you see the output of `sudo`, `security`, `certutil`, etc. live.

### Examples

```bash
# Interactive install -- prompts for confirmation
orator-ssl-proxy cert-install-root-ca

# Non-interactive install
orator-ssl-proxy cert-install-root-ca --yes

# Just show me the commands without running them
orator-ssl-proxy cert-install-root-ca --print-only
```

Platform-specific details are documented in:

- [install-ca-mac.md](install-ca-mac.md)
- [install-ca-windows.md](install-ca-windows.md)
- [install-ca-ubuntu.md](install-ca-ubuntu.md)
- [install-ca-ios.md](install-ca-ios.md) (manual, since iOS has no CLI)

---

## `cert-uninstall-root-ca`

Remove the local CA from the OS trust store. Inverse of `cert-install-root-ca`.

### Usage

```bash
orator-ssl-proxy cert-uninstall-root-ca [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--print-only` | -- | Only print the commands that would run. |
| `--yes` | -- | Skip the confirmation prompt. |
| `--purge` | -- | Also delete the CA key/cert/meta files from disk. |

### Examples

```bash
# Remove CA from OS trust store but keep the files on disk
orator-ssl-proxy cert-uninstall-root-ca

# Full clean wipe
orator-ssl-proxy cert-uninstall-root-ca --yes --purge
```

---

## `cert-export-root-ca`

Copy the local CA's public cert to a user-specified path (or stdout) for transfer to another device -- a phone, a tablet, a second laptop, a CI runner.

### Usage

```bash
orator-ssl-proxy cert-export-root-ca [output-path]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `output-path` | Destination path. If omitted, the CA cert is written to stdout. |

### Examples

```bash
# Copy to a specific file (for AirDrop, email, scp, etc.)
orator-ssl-proxy cert-export-root-ca ~/Desktop/dev-ca.cert

# Pipe to clipboard on macOS
orator-ssl-proxy cert-export-root-ca | pbcopy

# Use in a shell script
CA_PEM=$(orator-ssl-proxy cert-export-root-ca)
```

The command only exports the **public** cert, never the private key. The key remains at `~/.orator-ssl/certs/selfsigned/ca.key` and is never touched by this command -- share that separately and only with machines you want to be able to sign new leaves.

---

## `explain-config`

Dump every configurable key and its currently-resolved value. Provided automatically by `pict-service-commandlineutility` via `AutoAddConfigurationExplanationCommand: true`.

### Usage

```bash
orator-ssl-proxy explain-config
```

Use this to debug why a setting isn't behaving the way you expect -- it shows the final merged value after the config file chain, defaults, and any CLI overrides you pass alongside.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Unhandled error during command execution |
| `2` | Invalid command-line arguments |

Configuration validation failures exit with `1` and print all errors to stderr before the process exits.
