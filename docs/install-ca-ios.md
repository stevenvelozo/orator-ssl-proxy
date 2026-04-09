# Install the Local CA on iPhone and iPad

Getting the orator-ssl-proxy local root CA trusted on iOS and iPadOS takes three distinct steps, **all of which are required**. This is different from desktop platforms, which usually need just one step. Apple's extra hurdles are designed to prevent malicious profiles from silently installing trust roots.

The steps are:

1. **Transfer** the CA file to the device (email, AirDrop, download)
2. **Install the profile** in Settings
3. **Enable full trust** in a separate Settings page

If you skip step 3, Safari will still show a warning. This is the step most people miss.

## Step 1: Export the CA From Your Dev Machine

On the machine where you generated the CA (typically the one also running the proxy):

```bash
orator-ssl-proxy cert-export-root-ca ~/Desktop/orator-ssl-ca.cert
```

You now have a file at `~/Desktop/orator-ssl-ca.cert`. This is the root CA cert — it contains no private key and is safe to transfer.

## Step 2: Get the File Onto Your Device

Pick whichever method is convenient:

### Option A: AirDrop (macOS → iOS, easiest)

- On your Mac, right-click `orator-ssl-ca.cert` → **Share → AirDrop**
- On your iPhone/iPad, accept the AirDrop
- iOS will prompt "This website is trying to download a configuration profile..." — tap **Allow**

### Option B: Email Attachment

- Email the `.cert` file to yourself as an attachment
- Open the email in the iOS Mail app
- Tap the attachment — iOS will show "Profile Downloaded"

### Option C: HTTP Download

Host the file on an HTTP server your phone can reach and visit the URL in Safari:

```bash
# On your dev machine, in the directory containing the cert:
npx -y http-server -p 9999 --cors
```

Then on your iPhone/iPad, open Safari and navigate to `http://<your-dev-machine-ip>:9999/orator-ssl-ca.cert`. iOS will show "Profile Downloaded".

### Option D: iCloud Drive / Dropbox / Google Drive

Upload the `.cert` to any cloud storage app, then open it on your iPhone/iPad through the corresponding app. Tap to install.

## Step 3: Install the Downloaded Profile

After any of the above transfer methods, iOS does **not** auto-install the profile. You have to go install it manually:

1. Open **Settings** (the gear icon on the home screen)
2. At the **top** of the Settings list you should see a new entry labeled **Profile Downloaded** (or **Configuration Profile**). Tap it.
   - If you don't see it at the top, scroll down to **General → VPN & Device Management** and look for the pending profile there.
3. You'll see a profile named "Retold Orator SSL Proxy Local CA" (or whatever you set as `caCommonName`). Tap **Install** in the upper right.
4. Enter your device passcode when prompted.
5. iOS will warn "Installing the certificate 'Retold Orator SSL Proxy Local CA' will add it to the list of trusted certificates on your iPhone." Tap **Install** in the warning dialog.
6. Tap **Done** in the upper right.

At this point the profile is installed but **not yet trusted**. Safari will still show a cert warning until you complete Step 4.

## Step 4: Enable Full Trust (Critical!)

This is the step most people miss. Apple intentionally separates profile installation from trust activation.

1. Still in **Settings**, navigate to **General → About**
2. Scroll all the way to the bottom
3. Tap **Certificate Trust Settings**
4. Under **Enable Full Trust For Root Certificates**, find the entry for "Retold Orator SSL Proxy Local CA" (or your custom name)
5. Toggle the switch **on** (it should turn green)
6. iOS will show a warning: "Enabling this certificate for websites will allow third parties to monitor any private data sent to the websites." This warning exists because a malicious CA would let an attacker intercept HTTPS traffic — but since you generated this CA yourself on your own machine, it's safe. Tap **Continue**.

**Now the CA is fully trusted** for HTTPS connections from Safari.

## Step 5: Verify

On your iPhone/iPad, open Safari and navigate to `https://awesomeapp.localhost:13711/` (or whatever hostname and port the proxy is serving).

You should see:

- **No cert warning**
- A lock icon in the address bar (no "Not Secure" text)
- The backend content rendering normally

If you tap the lock icon → "Show Certificate", you should see the cert chain ending at your Retold Orator SSL Proxy Local CA.

### Testing With a Hostname Other Than `.localhost`

iOS will resolve `*.localhost` to `127.0.0.1` on the device itself, but that's almost never what you want — the proxy is running on a different machine. You have two options for reaching the proxy from iOS:

### Option A: Use the Dev Machine's LAN IP + Host Header

Configure your proxy with the dev machine's LAN IP bound on port 443 (or a high port with `cap_net_bind_service` or `sudo`), and use a fake hostname that resolves to that IP. The cleanest way is to add an entry to your router's DNS server (if it supports local DNS):

```
awesomeapp.lan  →  192.168.1.100
```

Then on iOS, visiting `https://awesomeapp.lan:443/` works.

### Option B: Real Public DNS

If you own a real domain, create a DNS A record that points to your dev machine's LAN IP (or to a VPN-accessible IP). iOS will resolve it normally, and the proxy will route based on the Host header.

## iPad Setup

iPad setup is **identical** to iPhone. Same four steps. The Settings app layout is the same (in the sidebar on iPad instead of a vertical list on iPhone, but the path — Settings → General → About → Certificate Trust Settings — is unchanged).

## App Compatibility

| App | Honors User-Installed CAs | Notes |
|-----|---------------------------|-------|
| Safari | Yes | After Step 4 (Enable Full Trust) |
| iOS Mail | Yes | Same trust store as Safari |
| Chrome on iOS | Yes | Chrome on iOS is WebKit-based, uses iOS trust store |
| Firefox on iOS | Yes | Same as Chrome |
| Third-party apps | **Varies** | Native apps can opt out of user-installed CAs via App Transport Security; many do |
| In-app browsers (WKWebView) | Yes | Most apps use WebKit for embedded browsers |
| SFSafariViewController | Yes | Uses the system trust store |

If you hit an app that ignores your CA, that app has explicitly opted out of user-installed CAs in its `Info.plist` with `NSAllowsArbitraryLoads: NO` plus no exception for your domain. There's nothing you can do about that without rebuilding the app — use Safari to confirm your cert setup is correct, and accept that some apps just won't trust a local CA.

## Removing the CA

1. Open **Settings → General → VPN & Device Management**
2. Tap the profile entry for "Retold Orator SSL Proxy Local CA"
3. Tap **Remove Profile**
4. Enter your device passcode
5. Tap **Remove** in the confirmation dialog

The CA is immediately untrusted. There's no separate "disable full trust" step to reverse — removing the profile handles everything.

## Troubleshooting

**I don't see "Profile Downloaded" at the top of Settings.**
The download didn't trigger an install prompt. Scroll down to **General → VPN & Device Management** and look under **Downloaded Profile**. If it's still not there, the transfer failed — the file might have opened in a preview app instead of triggering the install flow. Try AirDrop or email attachment instead of Safari download.

**I installed the profile but Safari still warns.**
You didn't complete Step 4. Go to **Settings → General → About → Certificate Trust Settings** and enable the toggle for the CA. This is the step everyone misses — Apple intentionally separates install from trust-enable.

**"Cannot Install Profile: The profile is not signed."**
iOS requires configuration profiles to be signed for silent install. The raw `.cert` file is not a signed profile — but iOS still accepts it via the "Profile Downloaded" flow above. If you're seeing this error, you probably tried to install the file through a mechanism (like Apple Configurator) that requires a signed `.mobileconfig`. Use one of the four transfer methods above (AirDrop, email, HTTP, cloud storage) and install via Settings.

**Chrome on iOS shows a cert warning.**
Chrome on iOS uses WebKit under the hood and consults the iOS trust store the same way Safari does. If Safari trusts the CA and Chrome doesn't, you probably installed the CA for the wrong user profile on iOS (unlikely — iOS doesn't have multi-user profiles) or you haven't enabled full trust in Step 4.

**Native app ignores the CA entirely (e.g., a custom REST client).**
That app has set App Transport Security (ATS) to reject user-installed CAs. There's no user-space workaround — the app author has to change their ATS config and ship an update. Try your test from Safari instead.

**Certificate Trust Settings screen is missing the Enable Full Trust section entirely.**
This screen only appears when at least one user-installed root CA is present on the device. If you see the screen but no CA toggle, the profile install didn't actually succeed — go back to Step 3 and reinstall.

**I see multiple "Retold Orator SSL Proxy Local CA" entries.**
Each time you install without uninstalling first, iOS accumulates a new copy. Remove the old profiles from **Settings → General → VPN & Device Management** to clean up.
