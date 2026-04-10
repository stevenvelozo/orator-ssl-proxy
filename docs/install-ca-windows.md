# Install the Local CA on Windows

This guide covers Windows 10 and Windows 11. The steps are identical on both -- Windows 11 uses the same `certutil` command-line tool and the same root certificate store as Windows 10. The only cosmetic difference is the path to the Settings app if you prefer the GUI route.

## TL;DR

Open a **regular (non-admin) PowerShell** window and run:

```powershell
orator-ssl-proxy cert-install-root-ca
```

This installs the CA into your personal (per-user) trust store with no UAC prompt. After it finishes, restart your browsers.

To install it machine-wide (so all users on the PC trust it), open **PowerShell as Administrator** and run:

```powershell
certutil -addstore -f "ROOT" "$env:USERPROFILE\.orator-ssl\certs\selfsigned\ca.cert"
```

## What This Actually Does

The `cert-install-root-ca` command runs:

```
certutil -user -addstore ROOT <path-to-ca.cert>
```

This adds the CA to the **current user's Trusted Root Certification Authorities** store. Windows will then trust any certificate signed by this CA when you browse with Edge, Chrome, or any other browser that uses the Windows trust store.

The `-user` flag means **no admin rights are required**. The CA is only trusted for the current Windows user account. That's usually what you want for a dev machine.

For machine-wide trust (all users), drop the `-user` flag and run `certutil` from an elevated Command Prompt or PowerShell.

## Step-by-Step

### 1. Install Node.js and orator-ssl-proxy

If you haven't already:

```powershell
# Using winget (Windows 10 1809+ / Windows 11 all versions)
winget install OpenJS.NodeJS.LTS

# Or download the installer from https://nodejs.org and run it

# Then install the proxy
npm install -g orator-ssl-proxy
```

### 2. Generate the CA

Start the proxy once so it auto-generates the CA:

```powershell
orator-ssl-proxy serve
```

Press `Ctrl+C` after a few seconds. The CA now lives at:

```
%USERPROFILE%\.orator-ssl\certs\selfsigned\ca.cert
```

(On most systems: `C:\Users\YourName\.orator-ssl\certs\selfsigned\ca.cert`.)

### 3. Run the Install Command

```powershell
orator-ssl-proxy cert-install-root-ca
```

Output will look like:

```
Platform: windows

Step 1: Install CA into Windows ROOT store (per-user, no admin)
  $ certutil -user -addstore ROOT C:\Users\me\.orator-ssl\certs\selfsigned\ca.cert

Notes:
  - For system-wide trust run: certutil -addstore -f "ROOT" C:\Users\me\.orator-ssl\certs\selfsigned\ca.cert (elevated)
  - iOS: ...
  - Android: ...

Run the commands above? [y/N]:
```

Type `y` and press Enter. No UAC prompt will appear because the per-user install doesn't require elevation.

### 4. Restart Your Browsers

- **Edge** -- close all Edge windows (including any in the system tray), then reopen
- **Chrome** -- close all Chrome windows, then reopen
- **Firefox** -- see [Firefox Setup](#firefox-setup) below

### 5. Verify

Open PowerShell and run:

```powershell
# List all CAs with "Retold" in the name in your per-user trust store
certutil -user -store ROOT | Select-String "Retold"
```

You should see the CA's subject line.

Then test with a browser:

- Open Edge
- Navigate to `https://awesomeapp.localhost:13711/` (substitute your actual hostname and port)
- No cert warning should appear

Or with `curl` (from PowerShell or WSL):

```powershell
curl -v --resolve awesomeapp.localhost:13711:127.0.0.1 `
    https://awesomeapp.localhost:13711/
```

No `-k` needed.

## Machine-Wide Install (All Users)

If you want every Windows user on the PC to trust the CA, install it into the machine (LocalMachine) ROOT store:

```powershell
# Open PowerShell as Administrator (right-click -> Run as Administrator)
certutil -addstore -f "ROOT" "$env:USERPROFILE\.orator-ssl\certs\selfsigned\ca.cert"
```

You'll see a UAC prompt when opening the elevated PowerShell, but `certutil` itself doesn't prompt again. This is what the `cert-install-root-ca --print-only` note refers to.

## Firefox Setup

Firefox maintains its own trust store (NSS) independent of the Windows system trust store. Two options:

### Option A: Use `certutil` From `libnss3-tools`

If you have `certutil` from NSS on your PATH (not the Windows `certutil`), the `cert-install-root-ca` command will detect your Firefox profiles and add the CA to each one automatically. This is uncommon on Windows -- most users take Option B.

### Option B: Manual Install in Firefox

1. Export the CA: `orator-ssl-proxy cert-export-root-ca C:\Users\YourName\Desktop\orator-ssl-ca.cert`
2. Open Firefox
3. Go to **Settings -> Privacy & Security -> View Certificates** (scroll down to the Certificates section)
4. Click **Authorities** tab -> **Import**
5. Browse to `C:\Users\YourName\Desktop\orator-ssl-ca.cert`
6. Check **Trust this CA to identify websites**
7. Click **OK** and restart Firefox

## Verify Install via `certlm.msc`

GUI inspection:

1. Press `Win+R`, type `certmgr.msc`, press Enter (per-user) or `certlm.msc` (machine-wide)
2. Navigate to **Trusted Root Certification Authorities -> Certificates**
3. Look for **Retold Orator SSL Proxy Local CA** (or your custom `caCommonName`)
4. Double-click to inspect the cert details and expiry

## Uninstalling

From a non-admin PowerShell:

```powershell
orator-ssl-proxy cert-uninstall-root-ca
```

This runs `certutil -user -delstore ROOT "Retold Orator SSL Proxy Local CA"`. Add `--purge` to also delete the CA files from disk:

```powershell
orator-ssl-proxy cert-uninstall-root-ca --purge
```

For the machine-wide install, run from elevated PowerShell:

```powershell
certutil -delstore "ROOT" "Retold Orator SSL Proxy Local CA"
```

## Troubleshooting

**`certutil` says the command succeeded but Edge still warns.**
Close **all** Edge windows (check the system tray for background processes) and reopen. Microsoft Edge keeps some background processes running that cache the trust store.

**`certutil -user -addstore` fails with "Access denied".**
Unusual -- the per-user store doesn't normally require elevation. Try opening PowerShell from a fresh logon session. If it still fails, your corporate device policy may have restricted per-user cert installs; contact IT or try the machine-wide install from an elevated prompt.

**Chrome shows `NET::ERR_CERT_AUTHORITY_INVALID`.**
Chrome uses the Windows system trust store on both Windows 10 and 11. Restart Chrome completely (check Task Manager for lingering `chrome.exe` processes and end them). Also check Chrome's internal HSTS state at `chrome://net-internals/#hsts` and delete any entry for the hostname.

**WSL (Windows Subsystem for Linux) doesn't trust the CA.**
WSL maintains its own Linux trust store separate from Windows. Run the CA install inside WSL too:

```bash
# In WSL
sudo cp /mnt/c/Users/YourName/.orator-ssl/certs/selfsigned/ca.cert \
    /usr/local/share/ca-certificates/orator-ssl-ca.crt
sudo update-ca-certificates
```

Or install Node.js inside WSL and run `orator-ssl-proxy cert-install-root-ca` there -- it will detect Ubuntu/Debian and install via `update-ca-certificates` automatically.

**Windows 10 vs Windows 11 -- is there any real difference?**
No. The trust store, `certutil` command, and all browser behavior are identical. Windows 11 moved a few cosmetic settings around in the Settings app, but the command-line workflow is unchanged.
