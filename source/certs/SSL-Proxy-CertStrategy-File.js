const libFS = require('fs');

const libSSLProxyCertStrategyBase = require('./SSL-Proxy-CertStrategy-Base.js');

/**
 * File-based cert strategy. Reads key/cert/ca PEMs from paths the user
 * supplies in config. No generation, no renewal.
 *
 * Config shape (under `certs.file`):
 *   default: { key, cert, ca }     // used as the SNI fallback
 *   hosts: [                       // per-host overrides
 *     { host, key, cert, ca },
 *     ...
 *   ]
 */
class SSLProxyCertStrategyFile extends libSSLProxyCertStrategyBase
{
	provision(fCallback)
	{
		try
		{
			let tmpFileConfig = this.config.certs.file || {};

			// Load per-host entries first
			if (Array.isArray(tmpFileConfig.hosts))
			{
				for (let tmpEntry of tmpFileConfig.hosts)
				{
					if (!tmpEntry || !tmpEntry.host || !tmpEntry.key || !tmpEntry.cert)
					{
						continue;
					}
					let tmpKey = libFS.readFileSync(tmpEntry.key, 'utf8');
					let tmpCert = libFS.readFileSync(tmpEntry.cert, 'utf8');
					let tmpCA = tmpEntry.ca ? libFS.readFileSync(tmpEntry.ca, 'utf8') : null;
					this.certStore.updateContext(tmpEntry.host, tmpKey, tmpCert, tmpCA);
					if (this.log)
					{
						this.log.info(`file cert loaded for [${tmpEntry.host}] from ${tmpEntry.cert}`);
					}
				}
			}

			// Load default
			if (tmpFileConfig.default && tmpFileConfig.default.key && tmpFileConfig.default.cert)
			{
				let tmpKey = libFS.readFileSync(tmpFileConfig.default.key, 'utf8');
				let tmpCert = libFS.readFileSync(tmpFileConfig.default.cert, 'utf8');
				let tmpCA = tmpFileConfig.default.ca ? libFS.readFileSync(tmpFileConfig.default.ca, 'utf8') : null;
				this.certStore.updateContext('*', tmpKey, tmpCert, tmpCA);
				if (this.log)
				{
					this.log.info(`file cert loaded as default from ${tmpFileConfig.default.cert}`);
				}
			}

			return fCallback(null);
		}
		catch (pError)
		{
			if (this.log)
			{
				this.log.error(`file cert strategy failed: ${pError.message}`, { Error: pError.message });
			}
			return fCallback(pError);
		}
	}
}

module.exports = SSLProxyCertStrategyFile;
