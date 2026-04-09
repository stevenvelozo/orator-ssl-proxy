const libFable = require('fable');

const libOratorSSLProxy = require('../Orator-SSL-Proxy.js');

/**
 * Boot a standalone orator-ssl-proxy process from a (possibly partial)
 * configuration object. Produces a fable instance, registers the
 * OratorSSLProxy service, and starts it listening.
 *
 * @param {object} pConfiguration - the orator-ssl-proxy config object
 * @param {object} [pExtraFableSettings] - merged into the Fable constructor
 * @param {(err?: Error, info?: object) => void} fCallback
 */
function setupServer(pConfiguration, pExtraFableSettings, fCallback)
{
	if (typeof (pExtraFableSettings) === 'function')
	{
		fCallback = pExtraFableSettings;
		pExtraFableSettings = null;
	}

	let tmpSettings = Object.assign(
		{
			Product: 'orator-ssl-proxy',
			ProductVersion: require('../../package.json').version,
			LogStreams: [{ level: (pConfiguration.logging && pConfiguration.logging.level) || 'info' }]
		},
		pExtraFableSettings || {});

	let tmpFable = new libFable(tmpSettings);

	tmpFable.serviceManager.addServiceType('OratorSSLProxy', libOratorSSLProxy);
	let tmpProxy;
	try
	{
		tmpProxy = tmpFable.serviceManager.instantiateServiceProvider('OratorSSLProxy',
			{
				Configuration: pConfiguration
			});
	}
	catch (pConstructorError)
	{
		return fCallback(pConstructorError);
	}

	tmpProxy.start((pStartError) =>
	{
		if (pStartError)
		{
			return fCallback(pStartError);
		}
		return fCallback(null,
			{
				Fable: tmpFable,
				Proxy: tmpProxy,
				Configuration: tmpProxy.configuration
			});
	});
}

module.exports = setupServer;
