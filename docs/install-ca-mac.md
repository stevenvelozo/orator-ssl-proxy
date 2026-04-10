# Install the Local CA on macOS

This guide walks you through installing the orator-ssl-proxy local root CA into your Mac so browsers trust every leaf cert the proxy issues.

## TL;DR

```bash
orator-ssl-proxy cert-install-root-ca
```

You will be prompted for your password (the command shells out to `sudo security add-trusted-cert`). After it completes, restart your browsers. Done.

## What This Actually Does

The `cert-install-root-ca` command runs:

```bash
sudo security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain \
    ~/.orator-ssl/certs/selfsigned/ca.cert
```

This adds the CA to the **System Keychain** with the `trustRoot` setting, which means every app that uses the system trust store -- Safari, Chrome, Edge, `curl`, `openssl`, most CLI tools -- will trust certificates signed by this CA. Firefox uses its own NSS store separately (see below).

## Step-by-Step

### 1. Generate the CA (If You Haven't Yet)

Either start the proxy once so it auto-generates the CA:

```bash
orator-ssl-proxy serve &
sleep 2
pkill -f 'orator-ssl-proxy serve'
```

Or run the install command, which will generate the CA if it doesn't exist yet:

```bash
orator-ssl-proxy cert-install-root-ca
```

You should see the CA appear at `~/.orator-ssl/certs/selfsigned/ca.cert`.

### 2. Run the Install Command

```bash
orator-ssl-proxy cert-install-root-ca
```

Output will look like:

```
Platform: macos

Step 1: Install CA into macOS system keychain
  $ sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /Users/me/.orator-ssl/certs/selfsigned/ca.cert

Notes:
  - iOS: transfer the CA file to the device...
  - Android: install via Settings -> ...

Run the commands above? [y/N]:
```

Type `y` and press Enter. macOS will prompt for your password to run `sudo`.

If you want to skip the confirmation prompt, use `--yes`:

```bash
orator-ssl-proxy cert-install-root-ca --yes
```

If you just want to see the commands without running them:

```bash
orator-ssl-proxy cert-install-root-ca --print-only
```

### 3. Restart Your Browsers

macOS loads the trust store when a process starts, so any already-running browser may still think the CA is untrusted. Quit and reopen:

- **Safari** -- `Cmd+Q`, then reopen
- **Chrome** -- `Cmd+Q`, then reopen
- **Edge** -- `Cmd+Q`, then reopen
- **Firefox** -- see [Firefox Setup](#firefox-setup) below

### 4. Verify

```bash
# With curl (should succeed without -k)
curl -v --resolve awesomeapp.localhost:13711:127.0.0.1 \
    https://awesomeapp.localhost:13711/

# With openssl (should show the CA as trusted)
openssl s_client -connect 127.0.0.1:13711 -servername awesomeapp.localhost < /dev/null 2>/dev/null \
    | grep -E 'Verify return code|issuer='
```

You should see `Verify return code: 0 (ok)` in the openssl output.

Open `https://awesomeapp.localhost:13711/` in Safari or Chrome -- no cert warning.

## Firefox Setup

Firefox maintains its own trust store (NSS) independent of the macOS system keychain. To install the CA into Firefox:

```bash
# Install NSS command-line tools (one time)
brew install nss

# Re-run the installer -- it will now detect Firefox profiles and add the CA
orator-ssl-proxy cert-install-root-ca
```

The installer auto-detects Firefox profiles under `~/Library/Application Support/Firefox/Profiles/` and uses `certutil` to add the CA to each one. Restart Firefox after the install completes.

### Manual Firefox Install

If you prefer the GUI:

1. Export the CA cert: `orator-ssl-proxy cert-export-root-ca ~/Desktop/orator-ssl-ca.cert`
2. Open Firefox, go to **Settings -> Privacy & Security -> Certificates -> View Certificates**
3. Click **Authorities** tab -> **Import**
4. Select `~/Desktop/orator-ssl-ca.cert`
5. Check **Trust this CA to identify websites** and click **OK**
6. Restart Firefox

## Verify Install via Keychain Access

You can inspect the installed CA visually:

1. Open **Keychain Access** (`Cmd+Space`, type `keychain access`)
2. Select the **System** keychain on the left
3. Click **Certificates** at the top
4. Look for the entry with CN `Retold Orator SSL Proxy Local CA` (or your custom `caCommonName`)
5. Double-click it to inspect -- the **Trust** section should show "When using this certificate: Always Trust"

## Uninstalling

To remove the CA from the system trust store:

```bash
orator-ssl-proxy cert-uninstall-root-ca
```

This runs `sudo security delete-certificate -c "Retold Orator SSL Proxy Local CA" /Library/Keychains/System.keychain`. It does **not** delete the CA key/cert files on disk -- pass `--purge` if you also want to wipe those:

```bash
orator-ssl-proxy cert-uninstall-root-ca --purge
```

## Troubleshooting

**`security: SecTrustSettingsSetTrustSettings: One or more parameters passed to a function were not valid.`**
You're probably running the command on an older macOS where the `-r trustRoot` flag syntax differs. Try running the command manually without `-r trustRoot` (less secure, but may work).

**`sudo: a password is required` fails in a non-interactive shell.**
Run the command from a regular Terminal window instead of an SSH session or automation tool that doesn't forward stdin to `sudo`. Or use `--print-only` to get the exact commands and run them yourself in a session that has a TTY.

**Safari still shows a warning after install.**
Quit Safari completely (right-click -> Quit, or `Cmd+Q`) and reopen. Simply closing the window isn't enough -- Safari caches the trust store at process launch.

**Chrome shows "Your connection is not private" even after the install.**
Chrome on macOS uses the system trust store by default, but Chrome sometimes caches trust decisions per-tab. Open a new Chrome window (not tab) and try again. If it still fails, go to `chrome://net-internals/#hsts` and delete any HSTS entry for your hostname.

**`curl: (60) SSL certificate problem: unable to get local issuer certificate`.**
The CA is not in the system store. Run `security find-certificate -c "Retold Orator SSL Proxy Local CA" /Library/Keychains/System.keychain` -- if it returns nothing, the install failed silently. Re-run `orator-ssl-proxy cert-install-root-ca --print-only` and execute the printed commands manually to see any error output.

**My Mac has multiple users. Does each user need to install the CA?**
No -- the System Keychain is machine-wide. A single install covers all users.
