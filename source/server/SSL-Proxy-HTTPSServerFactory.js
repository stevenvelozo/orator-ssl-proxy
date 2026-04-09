const libHTTPS = require('https');

/**
 * Builds the HTTPS server that terminates TLS, dispatches requests through
 * the host router and backend dispatcher, and forwards WebSocket upgrades.
 *
 * Separated from the main Orator-SSL-Proxy service provider so the
 * construction logic can be unit-tested and reused.
 */
const libOratorSSLProxyHTTPSServerFactory =
{
	/**
	 * @param {object} pOptions
	 * @param {object} pOptions.fable - fable instance (for logging)
	 * @param {object} pOptions.certStore - SSLProxyCertStore
	 * @param {object} pOptions.hostRouter - SSLProxyHostRouter
	 * @param {object} pOptions.backendDispatcher - SSLProxyBackendDispatcher
	 * @param {object} pOptions.httpsConfig - https config block (minVersion etc.)
	 * @param {boolean} [pOptions.accessLog=true]
	 * @returns {https.Server}
	 */
	create: function (pOptions)
	{
		let tmpFable = pOptions.fable;
		let tmpLog = tmpFable ? tmpFable.log : null;

		let tmpCertStore = pOptions.certStore;
		let tmpHostRouter = pOptions.hostRouter;
		let tmpBackendDispatcher = pOptions.backendDispatcher;
		let tmpHTTPSConfig = pOptions.httpsConfig || {};

		let tmpAccessLog = (pOptions.accessLog !== false);

		let tmpServerOptions =
		{
			SNICallback: (pServername, fCallback) =>
			{
				let tmpContext = tmpCertStore.getSecureContext(pServername);
				if (!tmpContext)
				{
					if (tmpLog)
					{
						tmpLog.warn(`No certificate loaded for SNI hostname [${pServername}]`);
					}
					return fCallback(new Error(`No certificate for ${pServername}`));
				}
				return fCallback(null, tmpContext);
			}
		};

		// Node requires a default key/cert even when SNICallback is present,
		// for clients that don't send SNI. Use whatever the cert store picked.
		let tmpDefaultKey = tmpCertStore.getDefaultKeyPem();
		let tmpDefaultCert = tmpCertStore.getDefaultCertPem();
		if (tmpDefaultKey && tmpDefaultCert)
		{
			tmpServerOptions.key = tmpDefaultKey;
			tmpServerOptions.cert = tmpDefaultCert;
		}

		if (tmpHTTPSConfig.minVersion)
		{
			tmpServerOptions.minVersion = tmpHTTPSConfig.minVersion;
		}
		if (tmpHTTPSConfig.ciphers)
		{
			tmpServerOptions.ciphers = tmpHTTPSConfig.ciphers;
		}

		let tmpRequestListener = (pRequest, pResponse) =>
		{
			let tmpRoute = tmpHostRouter.resolve(pRequest.headers && pRequest.headers.host);

			if (tmpAccessLog && tmpLog)
			{
				tmpLog.info(`https ${pRequest.method} ${pRequest.headers.host || '?'}${pRequest.url} → ${tmpRoute ? tmpRoute.target : '(no route)'}`);
			}

			if (!tmpRoute)
			{
				pResponse.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
				pResponse.end(`Bad Gateway: no backend configured for host [${pRequest.headers.host || ''}]`);
				return;
			}

			tmpBackendDispatcher.dispatchWeb(pRequest, pResponse, tmpRoute);
		};

		let tmpHTTPSServer = libHTTPS.createServer(tmpServerOptions, tmpRequestListener);

		// WebSocket upgrades: same routing axis, different dispatch.
		tmpHTTPSServer.on('upgrade', (pRequest, pSocket, pHead) =>
		{
			let tmpRoute = tmpHostRouter.resolve(pRequest.headers && pRequest.headers.host);

			if (tmpAccessLog && tmpLog)
			{
				tmpLog.info(`wss upgrade ${pRequest.headers.host || '?'}${pRequest.url} → ${tmpRoute ? tmpRoute.target : '(no route)'}`);
			}

			if (!tmpRoute || tmpRoute.ws === false)
			{
				try { pSocket.destroy(); } catch (pError) { /* already closed */ }
				return;
			}

			tmpBackendDispatcher.dispatchWs(pRequest, pSocket, pHead, tmpRoute);
		});

		tmpHTTPSServer.on('tlsClientError', (pError, pTLSSocket) =>
		{
			if (tmpLog)
			{
				tmpLog.debug(`tlsClientError: ${pError && pError.message}`);
			}
		});

		return tmpHTTPSServer;
	}
};

module.exports = libOratorSSLProxyHTTPSServerFactory;
