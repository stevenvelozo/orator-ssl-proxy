const libFS = require('fs');
const libPath = require('path');

const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

const libConfigLoader = require('../../config/SSL-Proxy-Configuration-Loader.js');
const libLocalCA = require('../../certs/SSL-Proxy-LocalCA.js');

/**
 * `orator-ssl-proxy cert-export-root-ca` — copy the local CA root cert
 * to a user-specified path (or stdout) for transfer to other devices.
 *
 * Prints platform-specific install hints for common target devices
 * (iOS, Android, another laptop, a CI runner).
 */
class OratorSSLProxyCommandCertExportRootCA extends libCommandLineCommand
{
	constructor(pFable, pManifest, pServiceHash)
	{
		super(pFable, pManifest, pServiceHash);

		this.options.CommandKeyword = 'cert-export-root-ca';
		this.options.Description = 'Export the local CA root cert for transfer to another device.';

		this.options.CommandArguments.push(
			{ Name: '[output-path]', Description: 'Path to write the CA cert to (default: stdout).' });

		this.addCommand();
	}

	onRunAsync(fCallback)
	{
		let tmpConfig;
		try
		{
			tmpConfig = libConfigLoader.normalise(this.pict && this.pict.ProgramConfiguration ? this.pict.ProgramConfiguration : {});
		}
		catch (pError)
		{
			this.log.error(`config error: ${pError.message}`);
			return fCallback(pError);
		}

		let tmpPaths = libLocalCA.paths(tmpConfig.certs.storagePath);
		if (!libFS.existsSync(tmpPaths.caCertPath))
		{
			this.log.error(`no local CA found at ${tmpPaths.caCertPath}`);
			this.log.error('  run "orator-ssl-proxy cert-install-root-ca" (or start the proxy at least once) to generate one');
			return fCallback(new Error('CA not found'));
		}

		let tmpCertPem = libFS.readFileSync(tmpPaths.caCertPath, 'utf8');

		let tmpDest = this.ArgumentString;
		if (tmpDest && tmpDest.length > 0)
		{
			let tmpResolved = libPath.resolve(tmpDest);
			libFS.writeFileSync(tmpResolved, tmpCertPem, { mode: 0o644 });
			this.log.info(`CA exported to ${tmpResolved}`);
			this.log.info('');
			this.log.info('Transfer hints:');
			this.log.info('  - iOS: email, AirDrop, or HTTP-download the file to the device, install the profile,');
			this.log.info('         then enable full trust in Settings → General → About → Certificate Trust Settings.');
			this.log.info('  - Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate.');
			this.log.info('         Some apps ignore user-installed CAs (Chrome included).');
			this.log.info('  - Another laptop: copy the file, run `orator-ssl-proxy cert-install-root-ca --print-only` on that machine');
			this.log.info('         to see the per-platform install commands, then run them.');
			this.log.info('  - CI runner: mount the file and point NODE_EXTRA_CA_CERTS at it.');
		}
		else
		{
			// Dump to stdout
			process.stdout.write(tmpCertPem);
		}
		return fCallback(null);
	}
}

module.exports = OratorSSLProxyCommandCertExportRootCA;
