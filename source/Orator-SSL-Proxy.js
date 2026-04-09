const libFableServiceProviderBase = require('fable-serviceproviderbase');

const libConfigLoader = require('./config/SSL-Proxy-Configuration-Loader.js');
const libHostRouter = require('./router/SSL-Proxy-HostRouter.js');
const libBackendDispatcher = require('./router/SSL-Proxy-BackendDispatcher.js');
const libCertStore = require('./certs/SSL-Proxy-CertStore.js');
const libACMEChallengeStore = require('./certs/SSL-Proxy-ACMEChallengeStore.js');
const libCertStrategySelfSigned = require('./certs/SSL-Proxy-CertStrategy-SelfSigned.js');
const libCertStrategyLetsEncrypt = require('./certs/SSL-Proxy-CertStrategy-LetsEncrypt.js');
const libCertStrategyFile = require('./certs/SSL-Proxy-CertStrategy-File.js');
const libHTTPSServerFactory = require('./server/SSL-Proxy-HTTPSServerFactory.js');
const libHTTPServerFactory = require('./server/SSL-Proxy-HTTPServerFactory.js');

/**
 * Orator SSL Proxy — Fable service provider.
 *
 * Composes the host router, backend dispatcher, cert store, cert strategy,
 * and HTTPS/HTTP servers into a single object with lifecycle methods.
 * Other Retold apps register it via:
 *
 *   fable.serviceManager.addServiceType('OratorSSLProxy', require('orator-ssl-proxy'));
 *   let tmpProxy = fable.serviceManager.instantiateServiceProvider('OratorSSLProxy', {
 *       Configuration: myLoadedConfigObject
 *   });
 *   tmpProxy.start(() => { ... });
 *
 * Note that this service provider does NOT depend on the Orator service
 * provider — it runs its own HTTPS/HTTP servers directly via native Node so
 * request bodies stream unbuffered and dispatch happens by Host header.
 */
class OratorSSLProxy extends libFableServiceProviderBase
{
	/**
	 * @param {object} pFable - the fable instance
	 * @param {object} pOptions - service options; supports:
	 *   - Configuration: a (possibly partial) orator-ssl-proxy config object
	 *   - LogLevel: numeric verbosity for extra logging
	 * @param {string} [pServiceHash]
	 */
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);

		this.serviceType = 'OratorSSLProxy';

		// Configuration resolution: explicit option → fable setting → empty
		let tmpUserConfig = (this.options && this.options.Configuration)
			? this.options.Configuration
			: (this.fable.settings && this.fable.settings.OratorSSLProxy)
				? this.fable.settings.OratorSSLProxy
				: {};

		// This throws on validation failure; callers should catch.
		this.configuration = libConfigLoader.load(tmpUserConfig);

		this.LogLevel = (this.options && typeof (this.options.LogLevel) === 'number')
			? this.options.LogLevel
			: 0;

		// Late-bound runtime state (populated in start())
		this.certStore = null;
		this.acmeChallengeStore = null;
		this.certStrategy = null;
		this.hostRouter = null;
		this.backendDispatcher = null;
		this.httpsServer = null;
		this.httpServer = null;
		this.renewalTimer = null;
		this.started = false;
	}

	/**
	 * Build the appropriate cert strategy instance for the current config.
	 */
	buildCertStrategy()
	{
		let tmpStrategyName = this.configuration.certs.strategy;

		let tmpStrategyOptions =
			{
				fable: this.fable,
				config: this.configuration,
				certStore: this.certStore,
				acmeChallengeStore: this.acmeChallengeStore
			};

		switch (tmpStrategyName)
		{
			case 'selfsigned':
				return new libCertStrategySelfSigned(tmpStrategyOptions);
			case 'letsencrypt':
				return new libCertStrategyLetsEncrypt(tmpStrategyOptions);
			case 'file':
				return new libCertStrategyFile(tmpStrategyOptions);
			default:
				throw new Error(`unknown certs.strategy: ${tmpStrategyName}`);
		}
	}

	/**
	 * Start the proxy: provision certs, build servers, begin listening.
	 *
	 * @param {(err?: Error) => void} fCallback
	 */
	start(fCallback)
	{
		if (this.started)
		{
			return fCallback(null);
		}

		try
		{
			this.certStore = new libCertStore(this.fable);
			this.acmeChallengeStore = new libACMEChallengeStore();

			this.hostRouter = new libHostRouter(
				this.fable,
				this.configuration.routes,
				this.configuration.default);
			this.backendDispatcher = new libBackendDispatcher(this.fable);

			this.certStrategy = this.buildCertStrategy();
		}
		catch (pError)
		{
			return fCallback(pError);
		}

		// Port 80 listener must start BEFORE the cert strategy provisions
		// (so Let's Encrypt's HTTP-01 challenge can be answered). We bind
		// it with a placeholder httpsPort, then recreate or reconfigure
		// after the HTTPS server is up — simpler just to bind early.
		let tmpShouldBindHTTP = (this.configuration.http
			&& this.configuration.http.port
			&& (this.configuration.http.redirectToHttps
				|| this.configuration.certs.strategy === 'letsencrypt'));

		let _startHTTPS = () =>
		{
			try
			{
				this.httpsServer = libHTTPSServerFactory.create(
					{
						fable: this.fable,
						certStore: this.certStore,
						hostRouter: this.hostRouter,
						backendDispatcher: this.backendDispatcher,
						httpsConfig: this.configuration.https,
						accessLog: this.configuration.logging && this.configuration.logging.accessLog
					});
			}
			catch (pError)
			{
				return fCallback(pError);
			}

			let tmpHTTPSPort = this.configuration.https.port;
			let tmpHTTPSHost = this.configuration.https.host;

			this.httpsServer.on('error', (pError) =>
			{
				this.log.error(`HTTPS server error: ${pError.message}`, { Error: pError.message });
			});

			this.httpsServer.listen(tmpHTTPSPort, tmpHTTPSHost, (pError) =>
			{
				if (pError)
				{
					return fCallback(pError);
				}
				this.log.info(`orator-ssl-proxy listening on https://${tmpHTTPSHost}:${tmpHTTPSPort}`);

				this.startRenewalTimer();
				this.started = true;
				return fCallback(null);
			});
		};

		let _bindHTTPIfNeeded = (pAfter) =>
		{
			if (!tmpShouldBindHTTP)
			{
				return pAfter();
			}
			try
			{
				this.httpServer = libHTTPServerFactory.create(
					{
						fable: this.fable,
						acmeChallengeStore: this.acmeChallengeStore,
						httpConfig: this.configuration.http,
						httpsPort: this.configuration.https.port,
						accessLog: this.configuration.logging && this.configuration.logging.accessLog
					});
			}
			catch (pError)
			{
				return fCallback(pError);
			}
			this.httpServer.on('error', (pError) =>
			{
				this.log.error(`HTTP server error: ${pError.message}`, { Error: pError.message });
			});
			this.httpServer.listen(this.configuration.http.port, this.configuration.http.host, (pError) =>
			{
				if (pError)
				{
					return fCallback(pError);
				}
				this.log.info(`orator-ssl-proxy (http/80 companion) listening on http://${this.configuration.http.host}:${this.configuration.http.port}`);
				return pAfter();
			});
		};

		_bindHTTPIfNeeded(() =>
		{
			this.certStrategy.provision((pProvisionError) =>
			{
				if (pProvisionError)
				{
					return fCallback(pProvisionError);
				}
				_startHTTPS();
			});
		});
	}

	/**
	 * Begin the periodic cert-renewal timer. Interval is driven by
	 * `certs.letsencrypt.renewCheckIntervalHours` (default 12).
	 */
	startRenewalTimer()
	{
		let tmpIntervalHours = (this.configuration.certs
			&& this.configuration.certs.letsencrypt
			&& this.configuration.certs.letsencrypt.renewCheckIntervalHours)
			|| 12;
		let tmpInterval = tmpIntervalHours * 60 * 60 * 1000;

		this.renewalTimer = setInterval(() =>
		{
			this.log.info('running periodic cert renewal check');
			this.certStrategy.checkAndRenew((pError) =>
			{
				if (pError)
				{
					this.log.error(`cert renewal check failed: ${pError.message}`, { Error: pError.message });
				}
			});
		}, tmpInterval);

		// Don't block process exit for an idle timer.
		if (this.renewalTimer && typeof (this.renewalTimer.unref) === 'function')
		{
			this.renewalTimer.unref();
		}
	}

	/**
	 * Stop the proxy and release resources.
	 *
	 * @param {(err?: Error) => void} fCallback
	 */
	stop(fCallback)
	{
		if (!this.started)
		{
			return fCallback(null);
		}

		if (this.renewalTimer)
		{
			clearInterval(this.renewalTimer);
			this.renewalTimer = null;
		}

		if (this.certStrategy && typeof (this.certStrategy.stop) === 'function')
		{
			this.certStrategy.stop();
		}

		let _closeHTTP = (fAfter) =>
		{
			if (this.httpServer)
			{
				this.httpServer.close(() => fAfter());
			}
			else
			{
				fAfter();
			}
		};
		let _closeHTTPS = (fAfter) =>
		{
			if (this.httpsServer)
			{
				this.httpsServer.close(() => fAfter());
			}
			else
			{
				fAfter();
			}
		};

		_closeHTTPS(() =>
		{
			_closeHTTP(() =>
			{
				if (this.backendDispatcher)
				{
					this.backendDispatcher.close();
				}
				this.started = false;
				this.log.info('orator-ssl-proxy stopped');
				return fCallback(null);
			});
		});
	}
}

module.exports = OratorSSLProxy;
