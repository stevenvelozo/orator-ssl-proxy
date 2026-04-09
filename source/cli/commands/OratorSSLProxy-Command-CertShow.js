const libFS = require('fs');
const libPath = require('path');

const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

const libConfigLoader = require('../../config/SSL-Proxy-Configuration-Loader.js');
const libLocalCA = require('../../certs/SSL-Proxy-LocalCA.js');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `orator-ssl-proxy cert-show` — list loaded cert metadata from the
 * configured cert storage path without starting the server.
 */
class OratorSSLProxyCommandCertShow extends libCommandLineCommand
{
	constructor(pFable, pManifest, pServiceHash)
	{
		super(pFable, pManifest, pServiceHash);

		this.options.CommandKeyword = 'cert-show';
		this.options.Description = 'Show currently-stored certs and their expiry dates.';

		this.options.CommandOptions.push(
			{ Name: '--hostname [host]', Description: 'Filter output to one hostname.', Default: '' });

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
			this.log.error(`failed to load configuration: ${pError.message}`);
			return fCallback(pError);
		}

		let tmpStoragePath = tmpConfig.certs.storagePath;
		let tmpFilter = (this.CommandOptions.hostname || '').toLowerCase();

		// Self-signed directory
		let tmpSelfSignedDir = libPath.join(tmpStoragePath, 'selfsigned');
		if (libFS.existsSync(tmpSelfSignedDir))
		{
			this.log.info(`=== selfsigned @ ${tmpSelfSignedDir} ===`);
			let tmpEntries;
			try
			{
				tmpEntries = libFS.readdirSync(tmpSelfSignedDir);
			}
			catch (pError)
			{
				this.log.error(`failed to read ${tmpSelfSignedDir}: ${pError.message}`);
				tmpEntries = [];
			}

			// CA
			let tmpCaCertPath = libPath.join(tmpSelfSignedDir, 'ca.cert');
			if (libFS.existsSync(tmpCaCertPath))
			{
				try
				{
					let tmpCertPem = libFS.readFileSync(tmpCaCertPath, 'utf8');
					let tmpNotAfter = libLocalCA.getNotAfter(tmpCertPem);
					let tmpDays = Math.floor((tmpNotAfter.getTime() - Date.now()) / MS_PER_DAY);
					this.log.info(`  CA        expires ${tmpNotAfter.toISOString()} (${tmpDays} days)`);
				}
				catch (pError)
				{
					this.log.warn(`  CA parse failed: ${pError.message}`);
				}
			}

			for (let tmpEntry of tmpEntries)
			{
				if (!tmpEntry.endsWith('.cert') || tmpEntry === 'ca.cert') continue;
				let tmpHostname = tmpEntry.slice(0, -5);
				if (tmpFilter && tmpHostname.toLowerCase() !== tmpFilter) continue;
				let tmpCertPath = libPath.join(tmpSelfSignedDir, tmpEntry);
				try
				{
					let tmpCertPem = libFS.readFileSync(tmpCertPath, 'utf8');
					let tmpNotAfter = libLocalCA.getNotAfter(tmpCertPem);
					let tmpDays = Math.floor((tmpNotAfter.getTime() - Date.now()) / MS_PER_DAY);
					this.log.info(`  ${tmpHostname.padEnd(30)} expires ${tmpNotAfter.toISOString()} (${tmpDays} days)`);
				}
				catch (pError)
				{
					this.log.warn(`  ${tmpHostname} parse failed: ${pError.message}`);
				}
			}
		}

		// Let's Encrypt directory
		let tmpLEDir = libPath.join(tmpStoragePath, 'letsencrypt');
		if (libFS.existsSync(tmpLEDir))
		{
			this.log.info(`=== letsencrypt @ ${tmpLEDir} ===`);
			let tmpEntries;
			try
			{
				tmpEntries = libFS.readdirSync(tmpLEDir);
			}
			catch (pError)
			{
				tmpEntries = [];
			}
			for (let tmpEntry of tmpEntries)
			{
				if (!tmpEntry.endsWith('.cert')) continue;
				let tmpHostname = tmpEntry.slice(0, -5);
				if (tmpFilter && tmpHostname.toLowerCase() !== tmpFilter) continue;
				let tmpCertPath = libPath.join(tmpLEDir, tmpEntry);
				try
				{
					let tmpCertPem = libFS.readFileSync(tmpCertPath, 'utf8');
					let tmpNotAfter = libLocalCA.getNotAfter(tmpCertPem);
					let tmpDays = Math.floor((tmpNotAfter.getTime() - Date.now()) / MS_PER_DAY);
					this.log.info(`  ${tmpHostname.padEnd(30)} expires ${tmpNotAfter.toISOString()} (${tmpDays} days)`);
				}
				catch (pError)
				{
					this.log.warn(`  ${tmpHostname} parse failed: ${pError.message}`);
				}
			}
		}

		return fCallback(null);
	}
}

module.exports = OratorSSLProxyCommandCertShow;
