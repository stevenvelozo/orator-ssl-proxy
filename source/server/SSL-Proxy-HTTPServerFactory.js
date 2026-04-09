const libHTTP = require('http');

const ACME_CHALLENGE_PREFIX = '/.well-known/acme-challenge/';

/**
 * Builds the plain HTTP companion server listening on (typically) port 80.
 *
 * It has two responsibilities:
 *   1. Serve `/.well-known/acme-challenge/<token>` responses from the
 *      shared ACMEChallengeStore so Let's Encrypt HTTP-01 challenges can
 *      complete.
 *   2. Optionally redirect everything else to HTTPS.
 */
const libOratorSSLProxyHTTPServerFactory =
{
	/**
	 * @param {object} pOptions
	 * @param {object} pOptions.fable - fable for logging
	 * @param {object} pOptions.acmeChallengeStore - SSLProxyACMEChallengeStore
	 * @param {object} pOptions.httpConfig - { redirectToHttps }
	 * @param {number} pOptions.httpsPort - port to redirect to (omitted from URL if 443)
	 * @param {boolean} [pOptions.accessLog=true]
	 * @returns {http.Server}
	 */
	create: function (pOptions)
	{
		let tmpFable = pOptions.fable;
		let tmpLog = tmpFable ? tmpFable.log : null;

		let tmpACMEStore = pOptions.acmeChallengeStore;
		let tmpHTTPConfig = pOptions.httpConfig || {};
		let tmpHTTPSPort = pOptions.httpsPort;
		let tmpAccessLog = (pOptions.accessLog !== false);

		let tmpRequestListener = (pRequest, pResponse) =>
		{
			if (tmpAccessLog && tmpLog)
			{
				tmpLog.info(`http  ${pRequest.method} ${pRequest.headers.host || '?'}${pRequest.url}`);
			}

			// ACME HTTP-01 challenge
			if (pRequest.url && pRequest.url.startsWith(ACME_CHALLENGE_PREFIX))
			{
				let tmpToken = pRequest.url.slice(ACME_CHALLENGE_PREFIX.length);
				let tmpKeyAuth = tmpACMEStore ? tmpACMEStore.get(tmpToken) : null;
				if (tmpKeyAuth)
				{
					pResponse.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
					pResponse.end(tmpKeyAuth);
					return;
				}
				pResponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
				pResponse.end('ACME challenge token not found');
				return;
			}

			// Redirect to HTTPS
			if (tmpHTTPConfig.redirectToHttps)
			{
				let tmpHost = pRequest.headers.host || '';
				// Strip :port from Host if present — we're rewriting the port anyway
				let tmpColon = tmpHost.lastIndexOf(':');
				if (tmpColon !== -1 && !tmpHost.startsWith('['))
				{
					tmpHost = tmpHost.slice(0, tmpColon);
				}
				let tmpPortSuffix = (tmpHTTPSPort && tmpHTTPSPort !== 443) ? `:${tmpHTTPSPort}` : '';
				let tmpLocation = `https://${tmpHost}${tmpPortSuffix}${pRequest.url}`;
				pResponse.writeHead(301, { 'Location': tmpLocation, 'Content-Type': 'text/plain; charset=utf-8' });
				pResponse.end(`Redirecting to ${tmpLocation}`);
				return;
			}

			pResponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
			pResponse.end('Not found');
		};

		return libHTTP.createServer(tmpRequestListener);
	}
};

module.exports = libOratorSSLProxyHTTPServerFactory;
