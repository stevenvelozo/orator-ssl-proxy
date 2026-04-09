const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

const libConfigLoader = require('../../config/SSL-Proxy-Configuration-Loader.js');
const libCertStore = require('../../certs/SSL-Proxy-CertStore.js');
const libACMEChallengeStore = require('../../certs/SSL-Proxy-ACMEChallengeStore.js');
const libCertStrategySelfSigned = require('../../certs/SSL-Proxy-CertStrategy-SelfSigned.js');
const libCertStrategyLetsEncrypt = require('../../certs/SSL-Proxy-CertStrategy-LetsEncrypt.js');
const libCertStrategyFile = require('../../certs/SSL-Proxy-CertStrategy-File.js');

/**
 * `orator-ssl-proxy cert-renew` — run the cert strategy's renewal check
 * once without starting the full server. Useful for scheduled one-shot
 * renewal jobs.
 */
class OratorSSLProxyCommandCertRenew extends libCommandLineCommand
{
	constructor(pFable, pManifest, pServiceHash)
	{
		super(pFable, pManifest, pServiceHash);

		this.options.CommandKeyword = 'cert-renew';
		this.options.Description = 'Check and renew certs once, without starting the server.';

		this.addCommand();
	}

	onRunAsync(fCallback)
	{
		let tmpConfig;
		try
		{
			tmpConfig = libConfigLoader.load(this.pict && this.pict.ProgramConfiguration ? this.pict.ProgramConfiguration : {});
		}
		catch (pError)
		{
			this.log.error(`config error: ${pError.message}`);
			return fCallback(pError);
		}

		let tmpCertStore = new libCertStore(this.fable);
		let tmpAcmeChallengeStore = new libACMEChallengeStore();

		let tmpStrategyOptions =
			{
				fable: this.fable,
				config: tmpConfig,
				certStore: tmpCertStore,
				acmeChallengeStore: tmpAcmeChallengeStore
			};
		let tmpStrategy;
		switch (tmpConfig.certs.strategy)
		{
			case 'selfsigned':
				tmpStrategy = new libCertStrategySelfSigned(tmpStrategyOptions);
				break;
			case 'letsencrypt':
				tmpStrategy = new libCertStrategyLetsEncrypt(tmpStrategyOptions);
				break;
			case 'file':
				tmpStrategy = new libCertStrategyFile(tmpStrategyOptions);
				break;
			default:
				return fCallback(new Error(`unknown certs.strategy: ${tmpConfig.certs.strategy}`));
		}

		this.log.info(`running renewal check for strategy [${tmpConfig.certs.strategy}]`);
		tmpStrategy.checkAndRenew((pError) =>
		{
			if (pError)
			{
				this.log.error(`renewal failed: ${pError.message}`);
				return fCallback(pError);
			}
			this.log.info('renewal check complete');
			return fCallback(null);
		});
	}
}

module.exports = OratorSSLProxyCommandCertRenew;
