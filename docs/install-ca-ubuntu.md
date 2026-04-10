# Install the Local CA on Ubuntu

This guide walks you through installing the orator-ssl-proxy local root CA into an Ubuntu system so browsers and CLI tools trust every leaf cert the proxy issues. The same steps work on Debian. For Fedora/RHEL and Arch, the paths and package names differ -- the installer handles those automatically.

## TL;DR

```bash
# Install NSS tools so Firefox gets the CA too (optional but recommended)
sudo apt-get install -y libnss3-tools

# Install the CA
orator-ssl-proxy cert-install-root-ca
```

After the command finishes, restart your browsers. Done.

## What This Actually Does

On Ubuntu/Debian, the `cert-install-root-ca` command runs:

```bash
sudo cp ~/.orator-ssl/certs/selfsigned/ca.cert /usr/local/share/ca-certificates/orator-ssl-ca.crt
sudo update-ca-certificates
```

This adds the CA to `/etc/ssl/certs/ca-certificates.crt`, which is the system-wide trust bundle consulted by `curl`, `wget`, Python's `requests` (via `certifi` -- see below), Chrome, Edge, `openssl`, and almost everything else that uses the OS trust store.

If `libnss3-tools` is installed and you have any Firefox profiles under `~/.mozilla/firefox/`, the installer will also loop through each profile and run:

```bash
certutil -A -n "Retold Orator SSL Proxy Local CA" -t "C,," \
    -i ~/.orator-ssl/certs/selfsigned/ca.cert \
    -d sql:~/.mozilla/firefox/<profile>
```

This adds the CA to Firefox's NSS database directly.

## Step-by-Step

### 1. Install Node.js 20+

```bash
# Add the NodeSource repo (or use your distro's built-in, but it's often too old)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version   # should report v20.x.x or higher
```

### 2. Install the Proxy

```bash
sudo npm install -g orator-ssl-proxy
```

### 3. Install NSS Tools (Recommended for Firefox Support)

```bash
sudo apt-get install -y libnss3-tools
```

Without this, the installer will skip Firefox and print a warning.

### 4. Generate the CA

Start the proxy once so it auto-generates the CA:

```bash
orator-ssl-proxy serve &
sleep 2
pkill -f 'orator-ssl-proxy serve'
```

The CA now lives at `~/.orator-ssl/certs/selfsigned/ca.cert`.

### 5. Run the Install Command

```bash
orator-ssl-proxy cert-install-root-ca
```

Output will look like:

```
Platform: linux-debian

Step 1: Copy CA to /usr/local/share/ca-certificates/
  $ sudo cp /home/me/.orator-ssl/certs/selfsigned/ca.cert /usr/local/share/ca-certificates/ca.crt

Step 2: Refresh system CA trust
  $ sudo update-ca-certificates

Step 3: Install CA into Firefox profile xxxx.default-release
  $ certutil -A -n "Retold Orator SSL Proxy Local CA" -t "C,," -i /home/me/.orator-ssl/certs/selfsigned/ca.cert -d sql:/home/me/.mozilla/firefox/xxxx.default-release

Notes:
  - iOS: ...
  - Android: ...

Run the commands above? [y/N]:
```

Type `y` and enter your sudo password when prompted.

To skip the confirmation:

```bash
orator-ssl-proxy cert-install-root-ca --yes
```

To see the commands without running:

```bash
orator-ssl-proxy cert-install-root-ca --print-only
```

### 6. Restart Your Browsers

- **Chrome / Chromium / Edge** -- close all windows, then reopen (they re-read the trust store at launch)
- **Firefox** -- close and reopen
- **Brave / Vivaldi / Opera** -- same as Chrome

### 7. Verify

```bash
# With curl -- no -k needed
curl -v --resolve awesomeapp.localhost:13711:127.0.0.1 \
    https://awesomeapp.localhost:13711/

# With openssl
openssl s_client -connect 127.0.0.1:13711 -servername awesomeapp.localhost < /dev/null 2>/dev/null \
    | grep -E 'Verify return code|issuer='

# Should show "Verify return code: 0 (ok)"
```

Or open `https://awesomeapp.localhost:13711/` in Chrome -- no warning.

## Other Linux Distros

### Fedora / RHEL / CentOS Stream / Rocky

The installer detects Fedora automatically and runs:

```bash
sudo cp ~/.orator-ssl/certs/selfsigned/ca.cert /etc/pki/ca-trust/source/anchors/ca.cert
sudo update-ca-trust
```

Everything else in this guide applies the same way. For Firefox NSS support, install `nss-tools`:

```bash
sudo dnf install -y nss-tools
```

### Arch / Manjaro

The installer runs:

```bash
sudo cp ~/.orator-ssl/certs/selfsigned/ca.cert /etc/ca-certificates/trust-source/anchors/ca.cert
sudo trust extract-compat
```

For Firefox NSS support, install `nss`:

```bash
sudo pacman -S nss
```

### Alpine / musl-based

Alpine isn't directly supported by the installer (detected as `linux-generic`). Install manually:

```bash
sudo cp ~/.orator-ssl/certs/selfsigned/ca.cert /usr/local/share/ca-certificates/orator-ssl-ca.crt
sudo update-ca-certificates
```

Alpine's `update-ca-certificates` works the same as Debian's.

## Language Runtimes With Their Own Trust Stores

Some language runtimes ship their own bundled CA lists and ignore the OS trust store by default:

### Python

Python's `requests` library uses `certifi`'s bundled CA list. To trust your local CA:

```bash
# Option 1: set REQUESTS_CA_BUNDLE env var
export REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

# Option 2: point at your CA file directly
export REQUESTS_CA_BUNDLE=~/.orator-ssl/certs/selfsigned/ca.cert

# Option 3 (system-wide): append the CA to certifi's bundle
cat ~/.orator-ssl/certs/selfsigned/ca.cert | \
    sudo tee -a $(python3 -c 'import certifi; print(certifi.where())')
```

### Node.js

Node reads the system trust store by default, but you can also point it at your CA file explicitly:

```bash
export NODE_EXTRA_CA_CERTS=~/.orator-ssl/certs/selfsigned/ca.cert
```

### Java

Java uses its own `cacerts` keystore. Install with:

```bash
sudo keytool -import -trustcacerts \
    -alias orator-ssl-ca \
    -file ~/.orator-ssl/certs/selfsigned/ca.cert \
    -keystore $JAVA_HOME/lib/security/cacerts \
    -storepass changeit -noprompt
```

### Rust (rustls)

`rustls` can use `rustls-native-certs` to read the OS trust store. If you're using `reqwest`, enable the `rustls-tls-native-roots` feature.

## Uninstalling

```bash
orator-ssl-proxy cert-uninstall-root-ca
```

On Ubuntu/Debian this runs:

```bash
sudo rm -f /usr/local/share/ca-certificates/ca.crt
sudo update-ca-certificates --fresh
```

Plus the corresponding `certutil -D` commands for any Firefox profiles. Add `--purge` to also delete the CA files from `~/.orator-ssl/certs/selfsigned/`.

## Troubleshooting

**`sudo: update-ca-certificates: command not found`.**
Install the `ca-certificates` package: `sudo apt-get install -y ca-certificates`.

**Firefox still shows a warning after install.**
Double-check that `libnss3-tools` was installed **before** you ran `cert-install-root-ca`. If you installed it after, re-run the command -- the installer will detect Firefox profiles and add the CA now. Also restart Firefox completely.

**`certutil: function failed: SEC_ERROR_BAD_DATABASE`.**
The Firefox profile's NSS database is in an old format. Open Firefox once to upgrade it, then re-run the installer.

**Chrome on Ubuntu 22.04+ still warns after install.**
Chrome on recent Ubuntu versions has started using its own bundled root store for some deployments. Force it to use the system trust store with the launch flag `--use-system-ssl-cert-verifier`, or check `chrome://flags/#use-ssl-trust-store`.

**WSL (running inside Windows)**
Same as native Ubuntu -- the install works exactly the same way. But note that WSL's trust store is **separate** from the Windows host's trust store. You need to install the CA separately in each.

**Snap packages (Firefox, Chromium, etc.) don't see the CA.**
Snap packages run in a confined environment with their own view of the filesystem. This is a known limitation on recent Ubuntu releases where Firefox ships as a snap. Options:

- Install the non-snap Firefox from Mozilla's APT repo
- Manually import the CA through Firefox's GUI (Settings -> Privacy & Security -> Certificates -> View Certificates -> Authorities -> Import)
- Use Chromium/Chrome via a non-snap install path

**I see `update-ca-certificates: Warning: orator-ssl-ca.crt does not contain a certificate or CRL`.**
The file at `/usr/local/share/ca-certificates/` must end in `.crt` (not `.cert`, `.pem`, etc.) for `update-ca-certificates` to pick it up. The installer handles this rename automatically, so this usually only shows if you installed the file manually.
