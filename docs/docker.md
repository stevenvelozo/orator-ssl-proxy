# Docker Deployment

Orator SSL Proxy ships with a production-ready Dockerfile and a reference `docker-compose.yml`. Both live at the module root.

## Image Overview

- **Base:** `node:20-slim` with `ca-certificates` and `openssl` added for CA trust and debugging
- **Build:** `npm ci --omit=dev --ignore-scripts` with a fallback to `npm install` if there's no lockfile
- **Source:** only `source/` is copied — tests, debug harness, and docs are excluded
- **Exposed ports:** `80` and `443`
- **Volumes:**
  - `/config` — read-only config mount (host file → container `/config/.orator-ssl.config.json`)
  - `/certs` — persistent cert storage (**must** survive container restarts for Let's Encrypt)
- **Entrypoint:** `node source/cli/OratorSSLProxy-CLI-Run.js serve --config /config/.orator-ssl.config.json --certs-path /certs --https-port 443 --http-port 80`
- **Healthcheck:** TCP connect test to `127.0.0.1:443` every 30s

## Build

From a clone of the module (or the CLI helper, if you have the package installed):

```bash
# From the module root
docker build -t orator-ssl-proxy:local .

# Or via the CLI
npx orator-ssl-proxy docker-build
```

The CLI helper resolves the module root automatically, so you can run it from anywhere.

## Run

### Quick Start

```bash
docker run --rm \
    -p 443:443 -p 80:80 \
    -v $HOME/.orator-ssl.config.json:/config/.orator-ssl.config.json:ro \
    -v $HOME/.orator-ssl/certs:/certs \
    orator-ssl-proxy:local
```

Or via the CLI helper:

```bash
npx orator-ssl-proxy docker-run
```

The helper applies the same mounts and port bindings by default. Override with flags:

```bash
npx orator-ssl-proxy docker-run \
    --tag orator-ssl-proxy:local \
    --https-port 8443 \
    --http-port 8080 \
    --config-path /etc/my-config.json \
    --certs-path /var/lib/orator-ssl \
    --detach
```

### Detached (Production)

```bash
docker run -d \
    --name orator-ssl-proxy \
    --restart unless-stopped \
    -p 443:443 -p 80:80 \
    -v /etc/orator-ssl/orator-ssl.config.json:/config/.orator-ssl.config.json:ro \
    -v /var/lib/orator-ssl:/certs \
    orator-ssl-proxy:local
```

## Compose

The shipped `docker-compose.yml` demonstrates a complete single-service deployment:

```yaml
version: "3.8"

services:
  orator-ssl-proxy:
    image: orator-ssl-proxy:local
    build: .
    container_name: orator-ssl-proxy
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ${HOME}/.orator-ssl.config.json:/config/.orator-ssl.config.json:ro
      - ${HOME}/.orator-ssl/certs:/certs
    environment:
      - NODE_ENV=production
```

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

## Multi-Service Compose (Proxy + Backends)

A more realistic setup where the proxy sits in front of several backend containers on the same Docker network:

```yaml
version: "3.8"

networks:
  internal:
    driver: bridge

services:
  orator-ssl-proxy:
    image: orator-ssl-proxy:local
    build:
      context: .
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./orator-ssl.config.json:/config/.orator-ssl.config.json:ro
      - orator-ssl-certs:/certs
    networks:
      - internal
    depends_on:
      - app-a
      - app-b

  app-a:
    image: myorg/app-a:latest
    restart: unless-stopped
    networks:
      - internal
    expose:
      - "3000"

  app-b:
    image: myorg/app-b:latest
    restart: unless-stopped
    networks:
      - internal
    expose:
      - "3000"

volumes:
  orator-ssl-certs:
```

With corresponding `orator-ssl.config.json`:

```json
{
    "https": { "port": 443, "host": "0.0.0.0" },
    "http":  { "port": 80, "host": "0.0.0.0", "redirectToHttps": true },
    "certs":
    {
        "strategy": "letsencrypt",
        "storagePath": "/certs",
        "letsencrypt":
        {
            "email": "admin@example.com",
            "staging": false
        }
    },
    "routes":
        [
            { "host": "a.example.com", "target": "http://app-a:3000" },
            { "host": "b.example.com", "target": "http://app-b:3000" }
        ]
}
```

Note that `target` uses the Docker service name (`app-a`, `app-b`) — Docker's internal DNS resolves these to the backend containers on the shared network.

## Volume: `/certs` Is Critical

**The `/certs` volume must be persistent.** Everything the proxy needs to remember between restarts lives there:

- `selfsigned/ca.key`, `ca.cert` — the local CA (for the `selfsigned` strategy)
- `selfsigned/{hostname}.{key,cert}` — per-host leaves
- `letsencrypt/account.key`, `account.url` — ACME account
- `letsencrypt/{hostname}.{key,cert}` — issued certs

For the `selfsigned` strategy, losing this volume means a new CA on next boot and your browser will distrust everything until you reinstall the new root.

For the `letsencrypt` strategy, losing this volume means:

1. A new ACME account has to be registered (no big deal)
2. New certs have to be issued for every hostname (counts against production rate limits — 50/week/domain)

**Always use a named Docker volume or a bind-mount to a persistent host path.** Never let `/certs` live in the container's ephemeral layer.

## Volume: `/config` Is Read-Only

The config file is never written at runtime, so mount it with `:ro` for safety:

```yaml
- ./orator-ssl.config.json:/config/.orator-ssl.config.json:ro
```

## Running as Non-Root (Optional)

The default image runs as `root` because ports 80 and 443 are privileged. If you want to run as a non-root user, you have three options:

### Option A: Use High Ports Inside the Container

Change your config to use a high port and map it externally:

```yaml
ports:
  - "443:8443"
  - "80:8080"
```

```json
{ "https": { "port": 8443 }, "http": { "port": 8080 } }
```

The container runs on 8443/8080 as a regular user, Docker maps host 443/80 to them.

### Option B: Use `cap_net_bind_service`

Add the capability in your compose file:

```yaml
services:
  orator-ssl-proxy:
    cap_add:
      - NET_BIND_SERVICE
    user: "1000:1000"
```

You'll also need to build a custom image that creates the user and grants Node the capability. Out of scope here — see the Node.js hardening guides.

### Option C: Run Behind Another Proxy

Put the container behind a traffic manager (Traefik, nginx, a cloud load balancer) that terminates the privileged port and forwards to the orator-ssl-proxy container on a high port. Defeats the purpose somewhat, but it's the safest production option.

## Logs

The container logs to stdout/stderr. Tail them with:

```bash
docker logs -f orator-ssl-proxy
# or
docker compose logs -f orator-ssl-proxy
```

Log levels are controlled by the `logging.level` field in your config:

```json
{ "logging": { "level": "debug" } }
```

## Updating the Image

```bash
# Rebuild
docker build -t orator-ssl-proxy:local .

# Recreate the container
docker compose up -d --force-recreate

# Or with plain docker run
docker stop orator-ssl-proxy
docker rm orator-ssl-proxy
docker run -d [...] orator-ssl-proxy:local
```

The `/certs` volume persists across updates, so certs (and Let's Encrypt account state) survive image upgrades.

## Healthcheck

The image ships with a TCP-connect healthcheck:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('net').createConnection(443,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
```

It doesn't validate certs or hit a real backend — it just confirms the HTTPS listener is accepting TCP connections. Use this as the liveness probe for orchestrators (Kubernetes, Docker Swarm, Nomad).

For a deeper check, run a `curl -kf https://localhost:443/healthz` that hits a dedicated backend. You can wire that up yourself in the `healthcheck` stanza of your compose file.

## Dockerfile Reference

```dockerfile
FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

RUN (npm ci --omit=dev --no-audit --no-fund --ignore-scripts \
        || npm install --omit=dev --no-audit --no-fund --ignore-scripts) \
    && npm cache clean --force

COPY source/ source/

ENV XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data \
    NODE_ENV=production

RUN mkdir -p /config /certs /data

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('net').createConnection(443,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "source/cli/OratorSSLProxy-CLI-Run.js", "serve", \
     "--config", "/config/.orator-ssl.config.json", \
     "--certs-path", "/certs", \
     "--https-port", "443", \
     "--http-port", "80"]
```

## Troubleshooting

**`bind: address already in use` for port 443 or 80.**
Something on the host is already bound to those ports. Common culprits: an existing nginx, apache2, or another Docker container. Check with `lsof -iTCP:443 -sTCP:LISTEN` or `ss -tlnp | grep :443`.

**Let's Encrypt issuance fails inside Docker.**
The container's port 80 must be reachable from the public internet. In production this usually means the host's firewall and cloud security groups both allow inbound 80, and that port 80 is mapped through to the container (`-p 80:80`). Check with `curl -v http://<public-ip>/.well-known/acme-challenge/test` from outside your network during the issuance window — you should see a `404` from the proxy itself (not a connection refused or timeout).

**The container restarts in a loop.**
Check logs with `docker logs orator-ssl-proxy`. Most common cause: invalid config file mounted into `/config/.orator-ssl.config.json`. The validator prints all failures before the process exits. Also confirm the mount path is correct — a bind-mount to a nonexistent file creates an empty directory in Docker, not an error.

**The proxy comes up but can't reach backends specified by name (e.g., `http://app-a:3000`).**
The proxy container needs to be on the same Docker network as the backends. Check with `docker network inspect <name>`. If you're using Docker Compose, adding `networks: [internal]` to both services and declaring the network at the top of the compose file is enough.

**`/certs` permissions wrong after switching between root and non-root containers.**
If you switch from running as root to running as a non-root user, the files in the volume may still be owned by root from the previous run. Reset ownership:

```bash
docker run --rm -v orator-ssl-certs:/certs alpine chown -R 1000:1000 /certs
```
