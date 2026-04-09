const libPath = require('path');
const libOS = require('os');

const libDefaultConfiguration = require('../Orator-SSL-Proxy-Default-Configuration.js');
const libPortHasher = require('../util/SSL-Proxy-Port-Hasher.js');

const PACKAGE_NAME = 'orator-ssl-proxy';

/**
 * Loads, merges, normalises and validates the orator-ssl-proxy configuration.
 *
 * The pict-service-commandlineutility CLI framework already walks the
 * multi-folder config chain (home → CWD → CWD/.config) for us, so this
 * loader's job is to:
 *
 *   1. Deep-merge the user's config over the built-in defaults
 *   2. Expand `~` and environment references in paths
 *   3. Resolve hashed default ports when `https.port` / `http.port` are null
 *   4. Validate the resulting shape
 *
 * It intentionally does not read files from disk — the CLI layer does that.
 */
const libOratorSSLProxyConfigurationLoader =
{
	/**
	 * Deep-merge two plain objects. Arrays and primitives from `pOverride`
	 * fully replace the corresponding entries in `pBase`; nested objects are
	 * merged key-by-key.
	 */
	deepMerge: function (pBase, pOverride)
	{
		if (pOverride === null || typeof (pOverride) === 'undefined')
		{
			return pBase;
		}
		if (typeof (pBase) !== 'object' || pBase === null || Array.isArray(pBase))
		{
			return pOverride;
		}
		if (typeof (pOverride) !== 'object' || Array.isArray(pOverride))
		{
			return pOverride;
		}

		let tmpResult = {};
		let tmpKeys = new Set([...Object.keys(pBase), ...Object.keys(pOverride)]);
		for (let tmpKey of tmpKeys)
		{
			if (tmpKey in pOverride)
			{
				tmpResult[tmpKey] = libOratorSSLProxyConfigurationLoader.deepMerge(pBase[tmpKey], pOverride[tmpKey]);
			}
			else
			{
				tmpResult[tmpKey] = pBase[tmpKey];
			}
		}
		return tmpResult;
	},

	/**
	 * Expand `~` to the user's home directory and resolve relative paths.
	 */
	expandPath: function (pPath)
	{
		if (typeof (pPath) !== 'string' || pPath.length < 1)
		{
			return pPath;
		}
		let tmpPath = pPath;
		if (tmpPath === '~' || tmpPath.startsWith('~/') || tmpPath.startsWith('~\\'))
		{
			tmpPath = libPath.join(libOS.homedir(), tmpPath.slice(1));
		}
		return libPath.resolve(tmpPath);
	},

	/**
	 * Produce a fully normalised configuration from a user-supplied (partial)
	 * config object. Fills in defaults, expands paths, resolves hashed ports.
	 *
	 * @param {object} pUserConfig - user config (may be empty or partial)
	 * @returns {object} the effective configuration
	 */
	normalise: function (pUserConfig)
	{
		let tmpMerged = libOratorSSLProxyConfigurationLoader.deepMerge(libDefaultConfiguration, pUserConfig || {});

		// Resolve hashed default ports when null
		let tmpHashedPorts = libPortHasher.hashPackageNameToHTTPSAndHTTPPorts(PACKAGE_NAME);
		if (tmpMerged.https.port === null || typeof (tmpMerged.https.port) === 'undefined')
		{
			tmpMerged.https.port = tmpHashedPorts.httpsPort;
		}
		if (tmpMerged.http.port === null || typeof (tmpMerged.http.port) === 'undefined')
		{
			tmpMerged.http.port = tmpHashedPorts.httpPort;
		}

		// Expand storage path and file cert paths
		tmpMerged.certs.storagePath = libOratorSSLProxyConfigurationLoader.expandPath(tmpMerged.certs.storagePath);

		if (tmpMerged.certs.file && tmpMerged.certs.file.default)
		{
			let tmpDefault = tmpMerged.certs.file.default;
			if (tmpDefault.key) tmpDefault.key = libOratorSSLProxyConfigurationLoader.expandPath(tmpDefault.key);
			if (tmpDefault.cert) tmpDefault.cert = libOratorSSLProxyConfigurationLoader.expandPath(tmpDefault.cert);
			if (tmpDefault.ca) tmpDefault.ca = libOratorSSLProxyConfigurationLoader.expandPath(tmpDefault.ca);
		}
		if (tmpMerged.certs.file && Array.isArray(tmpMerged.certs.file.hosts))
		{
			for (let tmpHostEntry of tmpMerged.certs.file.hosts)
			{
				if (tmpHostEntry.key) tmpHostEntry.key = libOratorSSLProxyConfigurationLoader.expandPath(tmpHostEntry.key);
				if (tmpHostEntry.cert) tmpHostEntry.cert = libOratorSSLProxyConfigurationLoader.expandPath(tmpHostEntry.cert);
				if (tmpHostEntry.ca) tmpHostEntry.ca = libOratorSSLProxyConfigurationLoader.expandPath(tmpHostEntry.ca);
			}
		}

		// Normalise routes
		if (!Array.isArray(tmpMerged.routes))
		{
			tmpMerged.routes = [];
		}
		for (let tmpRoute of tmpMerged.routes)
		{
			if (typeof (tmpRoute.host) === 'string')
			{
				tmpRoute.host = tmpRoute.host.toLowerCase();
			}
			if (typeof (tmpRoute.ws) === 'undefined')
			{
				tmpRoute.ws = true;
			}
		}

		return tmpMerged;
	},

	/**
	 * Validate a normalised configuration and return an array of error
	 * messages (empty = valid).
	 *
	 * @param {object} pConfig
	 * @returns {string[]}
	 */
	validate: function (pConfig)
	{
		let tmpErrors = [];

		if (!pConfig || typeof (pConfig) !== 'object')
		{
			tmpErrors.push('configuration must be an object');
			return tmpErrors;
		}

		if (!pConfig.certs || typeof (pConfig.certs) !== 'object')
		{
			tmpErrors.push('certs section is required');
		}
		else
		{
			let tmpValidStrategies = ['selfsigned', 'letsencrypt', 'file'];
			if (tmpValidStrategies.indexOf(pConfig.certs.strategy) === -1)
			{
				tmpErrors.push(`certs.strategy must be one of: ${tmpValidStrategies.join(', ')}`);
			}
			if (pConfig.certs.strategy === 'letsencrypt')
			{
				if (!pConfig.certs.letsencrypt || !pConfig.certs.letsencrypt.email)
				{
					tmpErrors.push('certs.letsencrypt.email is required when strategy is letsencrypt');
				}
			}
			if (pConfig.certs.strategy === 'selfsigned')
			{
				let tmpValidModes = ['localCA', 'adhoc'];
				if (tmpValidModes.indexOf(pConfig.certs.selfsigned.mode) === -1)
				{
					tmpErrors.push(`certs.selfsigned.mode must be one of: ${tmpValidModes.join(', ')}`);
				}
			}
		}

		if (!Array.isArray(pConfig.routes))
		{
			tmpErrors.push('routes must be an array');
		}
		else
		{
			for (let i = 0; i < pConfig.routes.length; i++)
			{
				let tmpRoute = pConfig.routes[i];
				if (!tmpRoute.host || typeof (tmpRoute.host) !== 'string')
				{
					tmpErrors.push(`routes[${i}].host is required`);
				}
				if (!tmpRoute.target || typeof (tmpRoute.target) !== 'string')
				{
					tmpErrors.push(`routes[${i}].target is required`);
				}
			}
		}

		// A proxy with no routes AND no default target can't serve anything
		let tmpHasDefault = pConfig.default && pConfig.default.target;
		if ((!Array.isArray(pConfig.routes) || pConfig.routes.length === 0) && !tmpHasDefault)
		{
			tmpErrors.push('configuration must define at least one route or a default.target');
		}

		// Port 0 is allowed and means "let the OS pick a random free port" — useful for tests.
		if (pConfig.https && typeof (pConfig.https.port) !== 'undefined' && pConfig.https.port !== null)
		{
			if (!Number.isInteger(pConfig.https.port) || pConfig.https.port < 0 || pConfig.https.port > 65535)
			{
				tmpErrors.push('https.port must be an integer between 0 and 65535');
			}
		}
		if (pConfig.http && typeof (pConfig.http.port) !== 'undefined' && pConfig.http.port !== null)
		{
			if (!Number.isInteger(pConfig.http.port) || pConfig.http.port < 0 || pConfig.http.port > 65535)
			{
				tmpErrors.push('http.port must be an integer between 0 and 65535');
			}
		}

		return tmpErrors;
	},

	/**
	 * One-shot: normalise + validate. Throws if invalid.
	 */
	load: function (pUserConfig)
	{
		let tmpConfig = libOratorSSLProxyConfigurationLoader.normalise(pUserConfig);
		let tmpErrors = libOratorSSLProxyConfigurationLoader.validate(tmpConfig);
		if (tmpErrors.length > 0)
		{
			let tmpError = new Error(`Invalid orator-ssl-proxy configuration:\n  - ${tmpErrors.join('\n  - ')}`);
			tmpError.ValidationErrors = tmpErrors;
			throw tmpError;
		}
		return tmpConfig;
	}
};

module.exports = libOratorSSLProxyConfigurationLoader;
