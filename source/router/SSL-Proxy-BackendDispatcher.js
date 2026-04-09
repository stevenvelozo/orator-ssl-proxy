const libHTTPProxy = require('http-proxy');

/**
 * Thin wrapper around the `http-proxy` library that centralises error
 * handling, forwarded-header injection, and WebSocket dispatch. One
 * instance per Orator-SSL-Proxy — shared across all routes — since
 * `http-proxy` handles concurrency and the per-call options override
 * the single shared target.
 */
class SSLProxyBackendDispatcher
{
	/**
	 * @param {object} pFable - parent fable for logging
	 */
	constructor(pFable)
	{
		this.fable = pFable;
		this.log = pFable ? pFable.log : null;

		this.httpProxyServer = libHTTPProxy.createProxyServer({});

		// One error handler for all forwarded traffic.
		this.httpProxyServer.on('error', this.handleProxyError.bind(this));
	}

	handleProxyError(pError, pRequest, pResponseOrSocket)
	{
		if (this.log)
		{
			this.log.warn(`proxy error for ${pRequest && pRequest.url}: ${pError && pError.message}`,
				{ Error: pError && pError.message });
		}

		// Web response
		if (pResponseOrSocket && typeof (pResponseOrSocket.writeHead) === 'function' && !pResponseOrSocket.headersSent)
		{
			try
			{
				pResponseOrSocket.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
				pResponseOrSocket.end(`Bad Gateway: ${pError && pError.message}`);
			}
			catch (pWriteError)
			{
				// Response may already be closed; nothing else to do.
			}
			return;
		}

		// WebSocket upgrade: the second arg is a net.Socket, which has .destroy()
		if (pResponseOrSocket && typeof (pResponseOrSocket.destroy) === 'function')
		{
			try
			{
				pResponseOrSocket.destroy();
			}
			catch (pDestroyError)
			{
				// Socket may already be closed.
			}
		}
	}

	/**
	 * Build the per-call options object for `http-proxy.web()`/`.ws()`.
	 */
	buildProxyOptions(pRouteEntry)
	{
		let tmpOptions =
		{
			target: pRouteEntry.target,
			secure: false,
			changeOrigin: true,
			xfwd: (pRouteEntry.xfwd !== false)
		};
		if (pRouteEntry.httpProxyOptions && typeof (pRouteEntry.httpProxyOptions) === 'object')
		{
			Object.assign(tmpOptions, pRouteEntry.httpProxyOptions);
		}
		return tmpOptions;
	}

	/**
	 * Forward a normal HTTP(S) request to the backend identified by the route
	 * entry. Errors are caught by the shared error handler.
	 */
	dispatchWeb(pRequest, pResponse, pRouteEntry)
	{
		let tmpOptions = this.buildProxyOptions(pRouteEntry);
		try
		{
			this.httpProxyServer.web(pRequest, pResponse, tmpOptions);
		}
		catch (pError)
		{
			this.handleProxyError(pError, pRequest, pResponse);
		}
	}

	/**
	 * Forward a WebSocket upgrade to the backend.
	 */
	dispatchWs(pRequest, pSocket, pHead, pRouteEntry)
	{
		let tmpOptions = this.buildProxyOptions(pRouteEntry);
		tmpOptions.ws = true;
		try
		{
			this.httpProxyServer.ws(pRequest, pSocket, pHead, tmpOptions);
		}
		catch (pError)
		{
			this.handleProxyError(pError, pRequest, pSocket);
		}
	}

	/**
	 * Release the underlying proxy server. Safe to call multiple times.
	 */
	close()
	{
		if (this.httpProxyServer && typeof (this.httpProxyServer.close) === 'function')
		{
			try
			{
				this.httpProxyServer.close();
			}
			catch (pError)
			{
				// Nothing to do — we're tearing down.
			}
		}
	}
}

module.exports = SSLProxyBackendDispatcher;
