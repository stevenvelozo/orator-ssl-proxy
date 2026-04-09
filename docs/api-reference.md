# API Reference

Complete reference for the public surface of `orator-ssl-proxy`. All paths are relative to the module root at `modules/orator/orator-ssl-proxy/`.

## Service Registration

Orator SSL Proxy is a Fable service provider. Register it with the service manager:

```javascript
const libOratorSSLProxy = require('orator-ssl-proxy');

_Fable.serviceManager.addServiceType('OratorSSLProxy', libOratorSSLProxy);

let _Proxy = _Fable.serviceManager.instantiateServiceProvider('OratorSSLProxy',
    {
        Configuration: { /* full or partial config */ },
        LogLevel: 0
    });
```

After instantiation, access it as the local variable or via `_Fable.OratorSSLProxy`.

---

## `OratorSSLProxy` (main service provider)

**File:** `source/Orator-SSL-Proxy.js`

### Constructor Options

| Option | Type | Description |
|--------|------|-------------|
| `Configuration` | object | A full or partial orator-ssl-proxy config. Deep-merged over defaults at construction. Throws if validation fails. |
| `LogLevel` | number | Verbosity hint for extra logging. `0` is quiet. |

If `Configuration` is not supplied, the loader reads from `fable.settings.OratorSSLProxy` instead.

### Methods

| Method | Description |
|--------|-------------|
| [`start(fCallback)`](#startfcallback) | Provision certs, bind both servers, begin the renewal timer |
| [`stop(fCallback)`](#stopfcallback) | Stop listening, clear timers, release resources |
| [`buildCertStrategy()`](#buildcertstrategy) | Internal factory for cert strategies; override for custom strategies |
| [`startRenewalTimer()`](#startrenewaltimer) | Called automatically from `start()`; exposed for custom lifecycles |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `configuration` | object | The fully resolved, normalised configuration |
| `certStore` | `SSLProxyCertStore` | In-memory cert store populated at `start()` time |
| `acmeChallengeStore` | `SSLProxyACMEChallengeStore` | Shared ACME challenge token store |
| `certStrategy` | `SSLProxyCertStrategyBase` | The active strategy instance |
| `hostRouter` | `SSLProxyHostRouter` | Host-header routing table |
| `backendDispatcher` | `SSLProxyBackendDispatcher` | `http-proxy` wrapper |
| `httpsServer` | `https.Server` or `null` | Active HTTPS listener (populated after `start()`) |
| `httpServer` | `http.Server` or `null` | Port-80 companion (populated if `http.port` is set) |
| `started` | boolean | `true` once `start()` has completed |

### `start(fCallback)`

Performs the full boot sequence:

1. Instantiates the cert store, ACME challenge store, host router, backend dispatcher, and cert strategy.
2. Optionally binds the port 80 companion listener (if `http.redirectToHttps` is true or the strategy is `letsencrypt`).
3. Calls `certStrategy.provision(fCallback)` to populate the cert store.
4. Builds the HTTPS server with SNI callback and WebSocket upgrade handler.
5. Calls `.listen()` on the HTTPS server.
6. Starts the renewal timer.

Calls `fCallback(pError)` on failure or `fCallback(null)` on success. Safe to call multiple times — subsequent calls are no-ops after the first successful start.

### `stop(fCallback)`

Reverse of `start()`:

1. Clears the renewal timer.
2. Calls `.close()` on the HTTPS and HTTP servers.
3. Calls `backendDispatcher.close()` to release the underlying `http-proxy` instance.
4. Marks `started = false`.

Calls `fCallback(null)` when all resources are released. Safe to call before `start()` — returns immediately with no error.

### `buildCertStrategy()`

Returns a new strategy instance based on `configuration.certs.strategy`. Throws for unknown strategy names. Override this method in a subclass to add custom strategies without touching the base service provider.

### `startRenewalTimer()`

Schedules `setInterval(() => certStrategy.checkAndRenew(), intervalMs)` where `intervalMs` is driven by `certs.letsencrypt.renewCheckIntervalHours`. The timer is `.unref()`'d so it doesn't hold the process open.

---

## `SSLProxyHostRouter`

**File:** `source/router/SSL-Proxy-HostRouter.js`

### Constructor

```javascript
new SSLProxyHostRouter(pFable, pRoutes, pDefaultRoute)
```

| Parameter | Description |
|-----------|-------------|
| `pFable` | Fable instance for logging (may be `null`) |
| `pRoutes` | Array of route entries `{ host, target, ws, xfwd, ... }` |
| `pDefaultRoute` | `{ target }` for the fall-through, or `null` |

### Methods

| Method | Description |
|--------|-------------|
| `setRoutes(pRoutes)` | Replace the route table. Splits entries into exact and wildcard lists and sorts wildcards longest-first. |
| `resolve(pHostHeader)` | Match a `Host` header to a route entry or the default. Returns `null` if no match. |
| `getCertHostnames()` | Return the list of exact hostnames that should get certs provisioned. |
| `getWildcardSuffixes()` | Return wildcard patterns (for diagnostics). |

### Static Methods

| Method | Description |
|--------|-------------|
| `normaliseHostHeader(pHost)` | Lowercase, strip `:port`, handle IPv6 brackets. |

---

## `SSLProxyBackendDispatcher`

**File:** `source/router/SSL-Proxy-BackendDispatcher.js`

Thin wrapper around `http-proxy` with shared error handling.

### Constructor

```javascript
new SSLProxyBackendDispatcher(pFable)
```

### Methods

| Method | Description |
|--------|-------------|
| `dispatchWeb(pRequest, pResponse, pRouteEntry)` | Forward an HTTP request to the route entry's target via `http-proxy.web()` |
| `dispatchWs(pRequest, pSocket, pHead, pRouteEntry)` | Forward a WebSocket upgrade via `http-proxy.ws()` |
| `buildProxyOptions(pRouteEntry)` | Construct the options object passed to `http-proxy`, applying defaults and per-route overrides |
| `handleProxyError(pError, pRequest, pResponseOrSocket)` | Shared error handler attached to `httpProxyServer.on('error')` |
| `close()` | Release the underlying `http-proxy` instance |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `httpProxyServer` | `http-proxy.Server` | The underlying `http-proxy` instance |

---

## `SSLProxyCertStore`

**File:** `source/certs/SSL-Proxy-CertStore.js`

In-memory `Map` of TLS `SecureContext` objects keyed by hostname, with exact/wildcard/default lookup.

### Methods

| Method | Description |
|--------|-------------|
| `updateContext(pHostname, pKeyPem, pCertPem, pCaPem)` | Insert or replace a cert. `pHostname` may be an exact name, a `*.pattern`, or `*` for the default. |
| `getSecureContext(pServername)` | SNI lookup. Returns a `tls.SecureContext` or `null`. |
| `getDefaultKeyPem()` | Default key PEM for the HTTPS server's fallback (non-SNI clients). |
| `getDefaultCertPem()` | Default cert PEM. |
| `describe()` | Return a plain object listing loaded hostnames (for diagnostics). |

### Static Methods

| Method | Description |
|--------|-------------|
| `buildContextPemPair(pKeyPem, pCertPem, pCaPem)` | Build a `tls.SecureContext` from PEM strings. |

---

## `SSLProxyCertStrategyBase`

**File:** `source/certs/SSL-Proxy-CertStrategy-Base.js`

Abstract base class for cert strategies. Subclasses override `provision()` and optionally `checkAndRenew()`.

### Constructor Options

| Option | Type | Description |
|--------|------|-------------|
| `fable` | object | Parent Fable for logging |
| `config` | object | Full resolved configuration |
| `certStore` | `SSLProxyCertStore` | Store to populate |
| `acmeChallengeStore` | `SSLProxyACMEChallengeStore` | Only used by the LetsEncrypt strategy |

### Methods

| Method | Description |
|--------|-------------|
| `collectHostnames()` | Return the list of hostnames to provision certs for (combines exact route hosts with `certs.hostnames`) |
| `provision(fCallback)` | Populate the cert store with an initial set of certs. **Override this.** |
| `checkAndRenew(fCallback)` | Check for and perform renewals. Default is a no-op. |
| `stop()` | Stop any internal timers. Default is a no-op. |

---

## `SSLProxyCertStrategySelfSigned`

**File:** `source/certs/SSL-Proxy-CertStrategy-SelfSigned.js`

Self-signed cert strategy with `localCA` and `adhoc` sub-modes. See [Configuration Reference](configuration.md#certsselfsigned) for options.

Reads `config.certs.selfsigned.mode` to decide behavior. On `provision()`:

- **`localCA`** — calls `libLocalCA.loadOrGenerateCA()`, then loops through `collectHostnames()` and calls `provisionLeafForHostname()` for each.
- **`adhoc`** — loops through `collectHostnames()` and calls `provisionAdhocForHostname()` for each.

Leaves cached on disk and within 30 days of expiry are reused; outside that window they're regenerated.

---

## `SSLProxyCertStrategyLetsEncrypt`

**File:** `source/certs/SSL-Proxy-CertStrategy-LetsEncrypt.js`

ACME HTTP-01 strategy using the `acme-client` npm package. See [Configuration Reference](configuration.md#certsletsencrypt) for options.

On `provision()`:

1. If `bootstrapWithSelfSigned` is true, seeds the cert store with 1-day self-signed placeholders so the HTTPS port can start immediately.
2. Loads or creates `{storagePath}/letsencrypt/account.key`.
3. Instantiates the ACME client with `directoryUrl` + `accountKey`.
4. For each hostname, either reuses a cached cert (if more than `renewBeforeDays` days remain) or requests a fresh one via `client.auto()`.
5. HTTP-01 challenge tokens flow through the shared `SSLProxyACMEChallengeStore` to the port-80 listener.

---

## `SSLProxyCertStrategyFile`

**File:** `source/certs/SSL-Proxy-CertStrategy-File.js`

Loads key/cert/ca PEMs from paths in `config.certs.file`. No generation or renewal.

---

## `SSLProxyLocalCA`

**File:** `source/certs/SSL-Proxy-LocalCA.js`

Pure-JS helpers for building a two-tier PKI with `node-forge`. Exported as a plain object (not a class).

### Functions

| Function | Description |
|----------|-------------|
| `paths(pStoragePath)` | Return `{ root, caKeyPath, caCertPath, caMetaPath }` for the CA |
| `leafPaths(pStoragePath, pHostname)` | Return `{ keyPath, certPath, metaPath }` for a leaf |
| `ensureDir(pDirectory)` | Create a directory with mode 700 if it doesn't exist |
| `atomicWrite(pPath, pContents, pMode)` | Write via `.tmp` + rename for atomicity |
| `randomSerial()` | Generate a positive hex serial number string |
| `generateCA(pOptions)` | Create a CA key pair and self-signed root cert |
| `loadOrGenerateCA(pOptions)` | Load the existing CA from disk or generate one and persist it |
| `generateLeaf(pOptions)` | Sign a new leaf cert with a CA |
| `generateAdhocSelfSigned(pOptions)` | Generate a stand-alone self-signed cert with no CA |
| `getNotAfter(pCertPem)` | Parse a cert PEM and return its `notAfter` date |

### `generateLeaf` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `caKeyPem` | string | required | CA private key PEM |
| `caCertPem` | string | required | CA cert PEM |
| `hostname` | string | required | Target hostname (goes in CN and SAN) |
| `validityDays` | number | `365` | Leaf validity in days |
| `keySize` | number | `2048` | RSA key size in bits |
| `extraHostnames` | array | `[]` | Additional DNS names to include in SAN |

Leaves always include `localhost`, `127.0.0.1`, and `::1` in the SAN list on top of `hostname` and `extraHostnames`.

---

## `SSLProxyACMEChallengeStore`

**File:** `source/certs/SSL-Proxy-ACMEChallengeStore.js`

Tiny in-memory `Map` shared between the LetsEncrypt strategy (writer) and the port-80 HTTP listener (reader).

### Methods

| Method | Description |
|--------|-------------|
| `set(pToken, pKeyAuthorization)` | Store a challenge response |
| `get(pToken)` | Look up a response (returns `null` if missing) |
| `remove(pToken)` | Delete a token |
| `clear()` | Wipe all tokens |
| `size()` | Current count |

---

## `SSLProxyTrustStoreInstaller`

**File:** `source/certs/SSL-Proxy-TrustStore-Installer.js`

Platform detection and OS trust-store install/uninstall plans. Used by the CLI `cert-install-root-ca`, `cert-uninstall-root-ca`, and `cert-export-root-ca` commands.

### Functions

| Function | Description |
|----------|-------------|
| `detectPlatform()` | Returns `"macos"`, `"linux-debian"`, `"linux-fedora"`, `"linux-arch"`, `"linux-generic"`, `"windows"`, or `"unknown"` |
| `buildInstallPlan(pCACertPath)` | Return a plan `{ platform, steps: [{label, commands, requiresElevation}], notes }` |
| `buildUninstallPlan(pCACertPath)` | Mirror of `buildInstallPlan` for removal |
| `runPlan(pPlan, fCallback)` | Execute a plan's commands sequentially via `child_process.spawn` with `stdio: 'inherit'` |
| `findFirefoxProfiles()` | Return the list of Firefox profile directories on this host |
| `hasCommand(pCommand)` | Check whether a command is on `PATH` |
| `formatPlan(pPlan)` | Turn a plan into a printable multi-line string |

---

## `SSLProxyConfigurationLoader`

**File:** `source/config/SSL-Proxy-Configuration-Loader.js`

Exported as a plain object with static-like functions.

### Functions

| Function | Description |
|----------|-------------|
| `deepMerge(pBase, pOverride)` | Recursive merge; arrays and primitives in `pOverride` replace the base entry entirely |
| `expandPath(pPath)` | Expand leading `~` to the user's home directory and resolve to an absolute path |
| `normalise(pUserConfig)` | Produce a fully resolved configuration: defaults merged, paths expanded, hashed ports resolved, routes normalised |
| `validate(pConfig)` | Return an array of validation error messages (empty = valid) |
| `load(pUserConfig)` | One-shot: `normalise` + `validate`. Throws on validation failure with a `ValidationErrors` property on the thrown `Error`. |

---

## `SSLProxyPortHasher`

**File:** `source/util/SSL-Proxy-Port-Hasher.js`

### Functions

| Function | Description |
|----------|-------------|
| `hashPackageNameToPort(pPackageName, pBase, pRange)` | Hash a package name to a deterministic port in `[pBase, pBase + pRange)`. Defaults: base 13000, range 4000. |
| `hashPackageNameToHTTPSAndHTTPPorts(pPackageName)` | Return `{ httpsPort, httpPort }` in non-overlapping ranges (13000-14999 and 15000-16999). |

---

## Server Factories

### `SSLProxyHTTPSServerFactory`

**File:** `source/server/SSL-Proxy-HTTPSServerFactory.js`

Exported as a plain object with a single `create(pOptions)` function. Builds an `https.Server` with SNI callback and `upgrade` handler wired to the provided cert store, host router, and backend dispatcher.

### `SSLProxyHTTPServerFactory`

**File:** `source/server/SSL-Proxy-HTTPServerFactory.js`

Exported as a plain object with a single `create(pOptions)` function. Builds an `http.Server` that serves `/.well-known/acme-challenge/*` from the shared ACME challenge store and (optionally) redirects everything else to HTTPS.
