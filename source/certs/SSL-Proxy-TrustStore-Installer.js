const libOS = require('os');
const libFS = require('fs');
const libPath = require('path');
const libChildProcess = require('child_process');

/**
 * Platform-aware helper that installs and uninstalls the local CA root
 * certificate into the OS trust store.
 *
 * Handles macOS, Linux (Debian/Ubuntu, Fedora/RHEL, Arch), and Windows.
 * On all platforms it also tries to update Firefox's NSS trust store via
 * `certutil` if it can find any Firefox profiles and `certutil` is on
 * PATH (from `libnss3-tools` on Linux, or Firefox's own bundled copy).
 *
 * The functions return a plan object describing the commands that would
 * run without actually running them. The caller (a CLI command) then
 * confirms with the user and calls `runPlan()` to execute. This keeps
 * the module reusable and testable.
 */

const CA_NICKNAME = 'Retold Orator SSL Proxy Local CA';

const libTrustStoreInstaller =
{
	CA_NICKNAME,

	/**
	 * Detect which platform family we're on, based on node's `os.platform()`
	 * and additional Linux distro probes.
	 */
	detectPlatform: function ()
	{
		let tmpPlat = libOS.platform();
		if (tmpPlat === 'darwin') return 'macos';
		if (tmpPlat === 'win32') return 'windows';
		if (tmpPlat !== 'linux') return 'unknown';

		// Linux flavor detection
		try
		{
			if (libFS.existsSync('/etc/debian_version'))
			{
				return 'linux-debian';
			}
			if (libFS.existsSync('/etc/fedora-release') || libFS.existsSync('/etc/redhat-release'))
			{
				return 'linux-fedora';
			}
			if (libFS.existsSync('/etc/arch-release'))
			{
				return 'linux-arch';
			}
		}
		catch (pError)
		{
			// Fall through
		}
		return 'linux-generic';
	},

	/**
	 * Build a plan for installing the CA root into the OS trust store.
	 *
	 * @param {string} pCACertPath - absolute path to the CA PEM
	 * @returns {{platform: string, steps: Array<{label: string, commands: string[][], requiresElevation: boolean}>, notes: string[]}}
	 */
	buildInstallPlan: function (pCACertPath)
	{
		let tmpPlatform = libTrustStoreInstaller.detectPlatform();
		let tmpPlan =
			{
				platform: tmpPlatform,
				steps: [],
				notes: []
			};

		switch (tmpPlatform)
		{
			case 'macos':
				tmpPlan.steps.push(
					{
						label: 'Install CA into macOS system keychain',
						commands: [['sudo', 'security', 'add-trusted-cert', '-d', '-r', 'trustRoot',
							'-k', '/Library/Keychains/System.keychain', pCACertPath]],
						requiresElevation: true
					});
				break;

			case 'linux-debian':
				{
					let tmpTarget = `/usr/local/share/ca-certificates/${libPath.basename(pCACertPath).replace(/\.cert$/, '.crt')}`;
					tmpPlan.steps.push(
						{
							label: 'Copy CA to /usr/local/share/ca-certificates/',
							commands: [['sudo', 'cp', pCACertPath, tmpTarget]],
							requiresElevation: true
						});
					tmpPlan.steps.push(
						{
							label: 'Refresh system CA trust',
							commands: [['sudo', 'update-ca-certificates']],
							requiresElevation: true
						});
				}
				break;

			case 'linux-fedora':
				{
					let tmpTarget = `/etc/pki/ca-trust/source/anchors/${libPath.basename(pCACertPath)}`;
					tmpPlan.steps.push(
						{
							label: 'Copy CA to /etc/pki/ca-trust/source/anchors/',
							commands: [['sudo', 'cp', pCACertPath, tmpTarget]],
							requiresElevation: true
						});
					tmpPlan.steps.push(
						{
							label: 'Refresh system CA trust',
							commands: [['sudo', 'update-ca-trust']],
							requiresElevation: true
						});
				}
				break;

			case 'linux-arch':
				{
					let tmpTarget = `/etc/ca-certificates/trust-source/anchors/${libPath.basename(pCACertPath)}`;
					tmpPlan.steps.push(
						{
							label: 'Copy CA to /etc/ca-certificates/trust-source/anchors/',
							commands: [['sudo', 'cp', pCACertPath, tmpTarget]],
							requiresElevation: true
						});
					tmpPlan.steps.push(
						{
							label: 'Refresh system CA trust',
							commands: [['sudo', 'trust', 'extract-compat']],
							requiresElevation: true
						});
				}
				break;

			case 'windows':
				tmpPlan.steps.push(
					{
						label: 'Install CA into Windows ROOT store (per-user, no admin)',
						commands: [['certutil', '-user', '-addstore', 'ROOT', pCACertPath]],
						requiresElevation: false
					});
				tmpPlan.notes.push('For system-wide trust run: certutil -addstore -f "ROOT" ' + pCACertPath + ' (elevated)');
				break;

			case 'linux-generic':
				tmpPlan.notes.push('Unknown Linux distro. Copy the CA to your distribution\'s trust-anchor directory and refresh manually.');
				break;

			default:
				tmpPlan.notes.push('Unknown platform. Install the CA manually into your OS trust store.');
				break;
		}

		// Firefox NSS store (if any profiles and certutil are available)
		let tmpFirefoxProfiles = libTrustStoreInstaller.findFirefoxProfiles();
		if (tmpFirefoxProfiles.length > 0)
		{
			if (libTrustStoreInstaller.hasCommand('certutil'))
			{
				for (let tmpProfile of tmpFirefoxProfiles)
				{
					tmpPlan.steps.push(
						{
							label: `Install CA into Firefox profile ${libPath.basename(tmpProfile)}`,
							commands: [['certutil', '-A', '-n', CA_NICKNAME, '-t', 'C,,', '-i', pCACertPath, '-d', `sql:${tmpProfile}`]],
							requiresElevation: false
						});
				}
			}
			else
			{
				tmpPlan.notes.push(
					'Firefox profile(s) detected but `certutil` is not on PATH. Install libnss3-tools (Debian/Ubuntu) or your distro\'s equivalent to add Firefox support.');
			}
		}

		// Mobile caveats
		tmpPlan.notes.push(
			'iOS: transfer the CA file to the device, install the profile, THEN enable full trust in ' +
			'Settings → General → About → Certificate Trust Settings.');
		tmpPlan.notes.push(
			'Android: install via Settings → Security → Encryption & credentials → Install a certificate → CA certificate. ' +
			'Many apps (including Chrome on Android) do not honor user-installed CAs; in-app webviews usually don\'t.');

		return tmpPlan;
	},

	/**
	 * Build the uninstall plan (inverse of install).
	 */
	buildUninstallPlan: function (pCACertPath)
	{
		let tmpPlatform = libTrustStoreInstaller.detectPlatform();
		let tmpPlan =
			{
				platform: tmpPlatform,
				steps: [],
				notes: []
			};

		switch (tmpPlatform)
		{
			case 'macos':
				tmpPlan.steps.push(
					{
						label: 'Remove CA from macOS system keychain',
						commands: [['sudo', 'security', 'delete-certificate', '-c', CA_NICKNAME,
							'/Library/Keychains/System.keychain']],
						requiresElevation: true
					});
				break;

			case 'linux-debian':
				{
					let tmpTarget = `/usr/local/share/ca-certificates/${libPath.basename(pCACertPath).replace(/\.cert$/, '.crt')}`;
					tmpPlan.steps.push(
						{
							label: 'Remove CA file',
							commands: [['sudo', 'rm', '-f', tmpTarget]],
							requiresElevation: true
						});
					tmpPlan.steps.push(
						{
							label: 'Refresh system CA trust',
							commands: [['sudo', 'update-ca-certificates', '--fresh']],
							requiresElevation: true
						});
				}
				break;

			case 'linux-fedora':
				{
					let tmpTarget = `/etc/pki/ca-trust/source/anchors/${libPath.basename(pCACertPath)}`;
					tmpPlan.steps.push(
						{
							label: 'Remove CA file',
							commands: [['sudo', 'rm', '-f', tmpTarget]],
							requiresElevation: true
						});
					tmpPlan.steps.push(
						{
							label: 'Refresh system CA trust',
							commands: [['sudo', 'update-ca-trust']],
							requiresElevation: true
						});
				}
				break;

			case 'linux-arch':
				{
					let tmpTarget = `/etc/ca-certificates/trust-source/anchors/${libPath.basename(pCACertPath)}`;
					tmpPlan.steps.push(
						{
							label: 'Remove CA file',
							commands: [['sudo', 'rm', '-f', tmpTarget]],
							requiresElevation: true
						});
					tmpPlan.steps.push(
						{
							label: 'Refresh system CA trust',
							commands: [['sudo', 'trust', 'extract-compat']],
							requiresElevation: true
						});
				}
				break;

			case 'windows':
				tmpPlan.steps.push(
					{
						label: 'Remove CA from Windows ROOT store',
						commands: [['certutil', '-user', '-delstore', 'ROOT', CA_NICKNAME]],
						requiresElevation: false
					});
				break;

			default:
				tmpPlan.notes.push('Unknown platform. Remove the CA manually from your OS trust store.');
				break;
		}

		let tmpFirefoxProfiles = libTrustStoreInstaller.findFirefoxProfiles();
		if (tmpFirefoxProfiles.length > 0 && libTrustStoreInstaller.hasCommand('certutil'))
		{
			for (let tmpProfile of tmpFirefoxProfiles)
			{
				tmpPlan.steps.push(
					{
						label: `Remove CA from Firefox profile ${libPath.basename(tmpProfile)}`,
						commands: [['certutil', '-D', '-n', CA_NICKNAME, '-d', `sql:${tmpProfile}`]],
						requiresElevation: false
					});
			}
		}

		return tmpPlan;
	},

	/**
	 * Execute a previously-built plan. Runs each command synchronously
	 * and streams output to the caller's stdout/stderr.
	 */
	runPlan: function (pPlan, fCallback)
	{
		let tmpResults = [];
		let _runStep = (pIndex) =>
		{
			if (pIndex >= pPlan.steps.length)
			{
				return fCallback(null, tmpResults);
			}
			let tmpStep = pPlan.steps[pIndex];
			let _runCommand = (pCmdIndex) =>
			{
				if (pCmdIndex >= tmpStep.commands.length)
				{
					return _runStep(pIndex + 1);
				}
				let tmpCommand = tmpStep.commands[pCmdIndex];
				let tmpProc = libChildProcess.spawn(tmpCommand[0], tmpCommand.slice(1), { stdio: 'inherit' });
				tmpProc.on('exit', (pCode) =>
				{
					tmpResults.push({ command: tmpCommand, exitCode: pCode });
					if (pCode !== 0)
					{
						return fCallback(new Error(`command failed (${pCode}): ${tmpCommand.join(' ')}`), tmpResults);
					}
					_runCommand(pCmdIndex + 1);
				});
				tmpProc.on('error', (pError) =>
				{
					return fCallback(pError, tmpResults);
				});
			};
			_runCommand(0);
		};
		_runStep(0);
	},

	/**
	 * Return the list of Firefox profile directories on this host, or [].
	 */
	findFirefoxProfiles: function ()
	{
		let tmpHome = libOS.homedir();
		let tmpCandidates =
			[
				libPath.join(tmpHome, '.mozilla', 'firefox'),
				libPath.join(tmpHome, 'Library', 'Application Support', 'Firefox', 'Profiles'),
				libPath.join(tmpHome, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles')
			];

		let tmpProfiles = [];
		for (let tmpBase of tmpCandidates)
		{
			if (!libFS.existsSync(tmpBase)) continue;
			try
			{
				let tmpEntries = libFS.readdirSync(tmpBase);
				for (let tmpEntry of tmpEntries)
				{
					let tmpFullPath = libPath.join(tmpBase, tmpEntry);
					if (libFS.statSync(tmpFullPath).isDirectory()
						&& (libFS.existsSync(libPath.join(tmpFullPath, 'cert9.db'))
							|| libFS.existsSync(libPath.join(tmpFullPath, 'cert8.db'))))
					{
						tmpProfiles.push(tmpFullPath);
					}
				}
			}
			catch (pError)
			{
				// Skip unreadable directories
			}
		}
		return tmpProfiles;
	},

	/**
	 * Check whether a command is available on PATH.
	 */
	hasCommand: function (pCommand)
	{
		try
		{
			let tmpIsWindows = (libOS.platform() === 'win32');
			let tmpProbe = libChildProcess.spawnSync(tmpIsWindows ? 'where' : 'which', [pCommand], { stdio: 'ignore' });
			return tmpProbe.status === 0;
		}
		catch (pError)
		{
			return false;
		}
	},

	/**
	 * Turn a plan into a printable multi-line string for `--print-only` mode.
	 */
	formatPlan: function (pPlan)
	{
		let tmpLines = [];
		tmpLines.push(`Platform: ${pPlan.platform}`);
		tmpLines.push('');
		if (pPlan.steps.length === 0)
		{
			tmpLines.push('(no automated steps available for this platform)');
		}
		for (let i = 0; i < pPlan.steps.length; i++)
		{
			let tmpStep = pPlan.steps[i];
			tmpLines.push(`Step ${i + 1}: ${tmpStep.label}`);
			for (let tmpCommand of tmpStep.commands)
			{
				tmpLines.push('  $ ' + tmpCommand.join(' '));
			}
			tmpLines.push('');
		}
		if (pPlan.notes.length > 0)
		{
			tmpLines.push('Notes:');
			for (let tmpNote of pPlan.notes)
			{
				tmpLines.push('  - ' + tmpNote);
			}
		}
		return tmpLines.join('\n');
	}
};

module.exports = libTrustStoreInstaller;
