/**
 * Abstract base class for cert strategies.
 *
 * Each strategy is responsible for:
 *   1. Producing an initial set of TLS key/cert pairs keyed by hostname
 *      and publishing them into the shared cert store on `provision()`
 *   2. Optionally checking for and performing renewals on a timer via
 *      `checkAndRenew()`
 *
 * Subclasses override `provision` and optionally `checkAndRenew`. The
 * base class just stashes its inputs and exposes convenience helpers.
 */
class SSLProxyCertStrategyBase
{
	/**
	 * @param {object} pOptions
	 * @param {object} pOptions.fable - parent fable for logging
	 * @param {object} pOptions.config - the full orator-ssl-proxy config
	 * @param {object} pOptions.certStore - SSLProxyCertStore to populate
	 */
	constructor(pOptions)
	{
		this.fable = pOptions.fable;
		this.log = this.fable ? this.fable.log : null;
		this.config = pOptions.config;
		this.certStore = pOptions.certStore;
	}

	/**
	 * Return the list of hostnames this strategy should provision certs for.
	 * Default implementation combines exact hostnames from `routes` with any
	 * extras listed under `certs.hostnames`.
	 *
	 * @returns {string[]}
	 */
	collectHostnames()
	{
		let tmpHosts = new Set();

		if (Array.isArray(this.config.routes))
		{
			for (let tmpRoute of this.config.routes)
			{
				if (!tmpRoute || !tmpRoute.host) continue;
				let tmpHost = String(tmpRoute.host).toLowerCase();
				if (!tmpHost.startsWith('*.'))
				{
					tmpHosts.add(tmpHost);
				}
			}
		}
		if (Array.isArray(this.config.certs.hostnames))
		{
			for (let tmpHost of this.config.certs.hostnames)
			{
				tmpHosts.add(String(tmpHost).toLowerCase());
			}
		}

		return Array.from(tmpHosts);
	}

	/**
	 * Populate the cert store with an initial set of certs.
	 *
	 * @param {(err?: Error) => void} fCallback
	 */
	provision(fCallback)
	{
		return fCallback(new Error('SSLProxyCertStrategyBase.provision must be overridden by subclasses'));
	}

	/**
	 * Perform a single renewal check and re-issue any certs that are within
	 * the configured renewal window. Base implementation is a no-op.
	 *
	 * @param {(err?: Error) => void} fCallback
	 */
	checkAndRenew(fCallback)
	{
		return fCallback(null);
	}

	/**
	 * Stop any internal timers. Base implementation is a no-op.
	 */
	stop()
	{
	}
}

module.exports = SSLProxyCertStrategyBase;
