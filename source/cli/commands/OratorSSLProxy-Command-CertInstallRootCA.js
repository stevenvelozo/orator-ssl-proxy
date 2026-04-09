const libFS = require('fs');
const libReadline = require('readline');

const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

const libConfigLoader = require('../../config/SSL-Proxy-Configuration-Loader.js');
const libLocalCA = require('../../certs/SSL-Proxy-LocalCA.js');
const libTrustStoreInstaller = require('../../certs/SSL-Proxy-TrustStore-Installer.js');

/**
 * `orator-ssl-proxy cert-install-root-ca` — generate the local CA (if it
 * doesn't exist yet) and install its root cert into the OS trust store.
 *
 * Detects the platform, prints the exact commands it will run, asks the
 * user to confirm, and then executes them. Supports `--print-only` for
 * users who want to copy-paste the commands instead.
 */
class OratorSSLProxyCommandCertInstallRootCA extends libCommandLineCommand
{
	constructor(pFable, pManifest, pServiceHash)
	{
		super(pFable, pManifest, pServiceHash);

		this.options.CommandKeyword = 'cert-install-root-ca';
		this.options.Description = 'Install the local CA root cert into the OS trust store (and Firefox NSS if detected).';

		this.options.CommandOptions.push(
			{ Name: '--print-only', Description: 'Only print the commands that would run, do not execute them.', Default: false });
		this.options.CommandOptions.push(
			{ Name: '--yes', Description: 'Skip the confirmation prompt.', Default: false });

		this.addCommand();
	}

	onRunAsync(fCallback)
	{
		let tmpSelf = this;

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

		let tmpStoragePath = tmpConfig.certs.storagePath;
		let tmpPaths = libLocalCA.paths(tmpStoragePath);

		// Ensure the CA exists. If not, generate it now.
		let tmpSelfSigned = tmpConfig.certs.selfsigned || {};
		if (!libFS.existsSync(tmpPaths.caCertPath) || !libFS.existsSync(tmpPaths.caKeyPath))
		{
			this.log.info(`no local CA found at ${tmpPaths.caCertPath} — generating a new one`);
			try
			{
				let tmpResult = libLocalCA.loadOrGenerateCA(
					{
						storagePath: tmpStoragePath,
						commonName: tmpSelfSigned.caCommonName,
						organization: tmpSelfSigned.caOrganization,
						validityYears: tmpSelfSigned.caValidityYears,
						keySize: tmpSelfSigned.keySize
					});
				this.log.info(`generated local CA; valid until ${tmpResult.notAfter.toISOString()}`);
			}
			catch (pError)
			{
				this.log.error(`failed to generate CA: ${pError.message}`);
				return fCallback(pError);
			}
		}

		let tmpPlan = libTrustStoreInstaller.buildInstallPlan(tmpPaths.caCertPath);

		this.log.info('');
		this.log.info(libTrustStoreInstaller.formatPlan(tmpPlan));
		this.log.info('');

		if (this.CommandOptions.printOnly)
		{
			this.log.info('(--print-only specified; not executing)');
			return fCallback(null);
		}

		if (tmpPlan.steps.length === 0)
		{
			this.log.warn('no automated install steps available for this platform — install manually per the notes above');
			return fCallback(null);
		}

		let _runPlan = () =>
		{
			libTrustStoreInstaller.runPlan(tmpPlan, (pError) =>
			{
				if (pError)
				{
					tmpSelf.log.error(`install failed: ${pError.message}`);
					return fCallback(pError);
				}
				tmpSelf.log.info('');
				tmpSelf.log.info('local CA installed successfully');
				tmpSelf.log.info('you may need to restart browsers to pick up the new trust root');
				return fCallback(null);
			});
		};

		if (this.CommandOptions.yes)
		{
			return _runPlan();
		}

		let tmpRL = libReadline.createInterface({ input: process.stdin, output: process.stdout });
		tmpRL.question('Run the commands above? [y/N]: ', (pAnswer) =>
		{
			tmpRL.close();
			let tmpAnswer = String(pAnswer || '').trim().toLowerCase();
			if (tmpAnswer !== 'y' && tmpAnswer !== 'yes')
			{
				tmpSelf.log.info('aborted');
				return fCallback(null);
			}
			return _runPlan();
		});
	}
}

module.exports = OratorSSLProxyCommandCertInstallRootCA;
