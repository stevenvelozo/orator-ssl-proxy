const libFS = require('fs');
const libPath = require('path');

const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

const libConfigLoader = require('../../config/SSL-Proxy-Configuration-Loader.js');

/**
 * `orator-ssl-proxy serve` — start the proxy listening locally.
 *
 * Configuration is picked up automatically by pict-service-commandlineutility
 * from the multi-folder chain (home → CWD → CWD/.config). CLI flags take
 * precedence over values in the file.
 */
class OratorSSLProxyCommandServe extends libCommandLineCommand
{
	constructor(pFable, pManifest, pServiceHash)
	{
		super(pFable, pManifest, pServiceHash);

		this.options.CommandKeyword = 'serve';
		this.options.Description = 'Start the SSL-terminating reverse proxy.';

		this.options.CommandOptions.push(
			{ Name: '-c, --config [path]', Description: 'Path to an explicit config file (bypasses the auto-loader chain).', Default: '' });
		this.options.CommandOptions.push(
			{ Name: '--https-port [port]', Description: 'HTTPS listen port override.', Default: '' });
		this.options.CommandOptions.push(
			{ Name: '--http-port [port]', Description: 'HTTP (port 80 companion) listen port override.', Default: '' });
		this.options.CommandOptions.push(
			{ Name: '--certs-path [path]', Description: 'Cert storage path override.', Default: '' });
		this.options.CommandOptions.push(
			{ Name: '--self-signed', Description: 'Force the selfsigned strategy regardless of config.', Default: false });
		this.options.CommandOptions.push(
			{ Name: '--staging', Description: 'Force Let\'s Encrypt staging mode.', Default: false });
		this.options.CommandOptions.push(
			{ Name: '-l, --logfile [path]', Description: 'Write logs to a file (auto-generated name if path omitted).', Default: '' });

		this.addCommand();
	}

	onRunAsync(fCallback)
	{
		let tmpSelf = this;

		// Pull the auto-loaded config from pict, or read an explicit --config file
		let tmpConfig = {};
		let tmpExplicitConfig = this.CommandOptions.config;
		if (tmpExplicitConfig && typeof (tmpExplicitConfig) === 'string' && tmpExplicitConfig.length > 0)
		{
			let tmpResolved = libPath.resolve(tmpExplicitConfig);
			if (!libFS.existsSync(tmpResolved))
			{
				this.log.error(`config file not found: ${tmpResolved}`);
				return fCallback(new Error(`config file not found: ${tmpResolved}`));
			}
			try
			{
				tmpConfig = JSON.parse(libFS.readFileSync(tmpResolved, 'utf8'));
			}
			catch (pParseError)
			{
				this.log.error(`failed to parse config file ${tmpResolved}: ${pParseError.message}`);
				return fCallback(pParseError);
			}
		}
		else if (this.pict && this.pict.ProgramConfiguration)
		{
			tmpConfig = JSON.parse(JSON.stringify(this.pict.ProgramConfiguration));
		}

		// Apply CLI overrides
		if (this.CommandOptions.httpsPort)
		{
			let tmpPort = parseInt(this.CommandOptions.httpsPort, 10);
			if (Number.isFinite(tmpPort))
			{
				tmpConfig.https = tmpConfig.https || {};
				tmpConfig.https.port = tmpPort;
			}
		}
		if (this.CommandOptions.httpPort)
		{
			let tmpPort = parseInt(this.CommandOptions.httpPort, 10);
			if (Number.isFinite(tmpPort))
			{
				tmpConfig.http = tmpConfig.http || {};
				tmpConfig.http.port = tmpPort;
			}
		}
		if (this.CommandOptions.certsPath && typeof (this.CommandOptions.certsPath) === 'string')
		{
			tmpConfig.certs = tmpConfig.certs || {};
			tmpConfig.certs.storagePath = this.CommandOptions.certsPath;
		}
		if (this.CommandOptions.selfSigned)
		{
			tmpConfig.certs = tmpConfig.certs || {};
			tmpConfig.certs.strategy = 'selfsigned';
		}
		if (this.CommandOptions.staging)
		{
			tmpConfig.certs = tmpConfig.certs || {};
			tmpConfig.certs.letsencrypt = tmpConfig.certs.letsencrypt || {};
			tmpConfig.certs.letsencrypt.staging = true;
		}

		// Configure file logging if requested
		let tmpLogfileOpt = this.CommandOptions.logfile;
		if (tmpLogfileOpt)
		{
			let tmpLogfilePath;
			if (typeof (tmpLogfileOpt) === 'string' && tmpLogfileOpt.length > 0)
			{
				tmpLogfilePath = libPath.resolve(tmpLogfileOpt);
			}
			else
			{
				tmpLogfilePath = libPath.resolve(`orator-ssl-proxy-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
			}
			try
			{
				let tmpStreamDef =
					{
						loggertype: 'simpleflatfile',
						level: 'info',
						path: tmpLogfilePath,
						outputloglinestoconsole: false,
						outputobjectstoconsole: false
					};
				let tmpFileLogger = new this.fable.log._Providers.simpleflatfile(tmpStreamDef, this.fable.log);
				tmpFileLogger.initialize();
				this.fable.log.addLogger(tmpFileLogger, 'info');
				this.log.info(`logging to file: ${tmpLogfilePath}`);
			}
			catch (pLoggerError)
			{
				this.log.warn(`failed to set up file logger: ${pLoggerError.message}`);
			}
		}

		let tmpSetupServer = require('../OratorSSLProxy-Server-Setup.js');
		tmpSetupServer(tmpConfig, (pError, pServerInfo) =>
		{
			if (pError)
			{
				tmpSelf.log.error(`failed to start orator-ssl-proxy: ${pError.message}`);
				if (pError.ValidationErrors)
				{
					for (let tmpValidation of pError.ValidationErrors)
					{
						tmpSelf.log.error(`  - ${tmpValidation}`);
					}
				}
				return fCallback(pError);
			}

			let tmpCfg = pServerInfo.Configuration;
			tmpSelf.log.info('');
			tmpSelf.log.info('==========================================================');
			tmpSelf.log.info(`  orator-ssl-proxy running`);
			tmpSelf.log.info('==========================================================');
			tmpSelf.log.info(`  HTTPS:      https://${tmpCfg.https.host}:${tmpCfg.https.port}`);
			if (tmpCfg.http && tmpCfg.http.port)
			{
				tmpSelf.log.info(`  HTTP (80):  http://${tmpCfg.http.host}:${tmpCfg.http.port}`);
			}
			tmpSelf.log.info(`  Strategy:   ${tmpCfg.certs.strategy}`);
			tmpSelf.log.info(`  Certs at:   ${tmpCfg.certs.storagePath}`);
			tmpSelf.log.info(`  Routes:     ${tmpCfg.routes.length} host-based`);
			for (let tmpRoute of tmpCfg.routes)
			{
				tmpSelf.log.info(`              ${tmpRoute.host} → ${tmpRoute.target}`);
			}
			if (tmpCfg.default && tmpCfg.default.target)
			{
				tmpSelf.log.info(`  Default:    * → ${tmpCfg.default.target}`);
			}
			tmpSelf.log.info('==========================================================');
			tmpSelf.log.info('');
			tmpSelf.log.info('  Press Ctrl+C to stop.');
			tmpSelf.log.info('');

			let _shutdown = () =>
			{
				tmpSelf.log.info('');
				tmpSelf.log.info('shutting down...');
				pServerInfo.Proxy.stop(() => process.exit(0));
			};
			process.on('SIGINT', _shutdown);
			process.on('SIGTERM', _shutdown);

			// Intentionally do NOT call fCallback() — the server keeps running.
		});
	}
}

module.exports = OratorSSLProxyCommandServe;
