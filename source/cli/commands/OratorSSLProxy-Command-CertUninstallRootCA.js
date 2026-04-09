const libFS = require('fs');
const libReadline = require('readline');

const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

const libConfigLoader = require('../../config/SSL-Proxy-Configuration-Loader.js');
const libLocalCA = require('../../certs/SSL-Proxy-LocalCA.js');
const libTrustStoreInstaller = require('../../certs/SSL-Proxy-TrustStore-Installer.js');

/**
 * `orator-ssl-proxy cert-uninstall-root-ca` — remove the local CA root
 * from the OS trust store. Does NOT delete the CA key/cert on disk
 * unless `--purge` is passed.
 */
class OratorSSLProxyCommandCertUninstallRootCA extends libCommandLineCommand
{
	constructor(pFable, pManifest, pServiceHash)
	{
		super(pFable, pManifest, pServiceHash);

		this.options.CommandKeyword = 'cert-uninstall-root-ca';
		this.options.Description = 'Remove the local CA root cert from the OS trust store.';

		this.options.CommandOptions.push(
			{ Name: '--print-only', Description: 'Only print the commands that would run.', Default: false });
		this.options.CommandOptions.push(
			{ Name: '--yes', Description: 'Skip the confirmation prompt.', Default: false });
		this.options.CommandOptions.push(
			{ Name: '--purge', Description: 'Also delete the CA key/cert files from disk.', Default: false });

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

		let tmpPaths = libLocalCA.paths(tmpConfig.certs.storagePath);
		let tmpPlan = libTrustStoreInstaller.buildUninstallPlan(tmpPaths.caCertPath);

		this.log.info('');
		this.log.info(libTrustStoreInstaller.formatPlan(tmpPlan));
		this.log.info('');

		if (this.CommandOptions.printOnly)
		{
			this.log.info('(--print-only specified; not executing)');
			return fCallback(null);
		}

		let _runPlan = () =>
		{
			libTrustStoreInstaller.runPlan(tmpPlan, (pError) =>
			{
				if (pError)
				{
					tmpSelf.log.warn(`uninstall reported an error: ${pError.message}`);
					// Keep going so --purge can still run
				}
				if (tmpSelf.CommandOptions.purge)
				{
					if (libFS.existsSync(tmpPaths.caKeyPath)) libFS.unlinkSync(tmpPaths.caKeyPath);
					if (libFS.existsSync(tmpPaths.caCertPath)) libFS.unlinkSync(tmpPaths.caCertPath);
					if (libFS.existsSync(tmpPaths.caMetaPath)) libFS.unlinkSync(tmpPaths.caMetaPath);
					tmpSelf.log.info('purged CA files on disk');
				}
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

module.exports = OratorSSLProxyCommandCertUninstallRootCA;
