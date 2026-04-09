const libTLS = require('tls');

/**
 * In-memory store of TLS SecureContext objects keyed by hostname.
 *
 * Used by the HTTPS server's SNICallback to pick the right certificate
 * for an incoming ClientHello. Cert strategies populate this store on
 * startup and call `updateContext()` when renewing without restarting
 * the server.
 *
 * Lookup order:
 *   1. Exact hostname match
 *   2. Longest wildcard match (`*.foo.example.com` before `*.example.com`)
 *   3. `*` default
 *   4. null (SNI fails, client handshake aborts)
 */
class SSLProxyCertStore
{
	constructor(pFable)
	{
		this.fable = pFable;
		this.log = pFable ? pFable.log : null;

		this.exactContexts = new Map();     // hostname → { context, keyPem, certPem }
		this.wildcardContexts = [];         // [{ suffix, context, keyPem, certPem }]
		this.defaultContext = null;         // { context, keyPem, certPem }
	}

	static buildContextPemPair(pKeyPem, pCertPem, pCaPem)
	{
		let tmpOptions =
		{
			key: pKeyPem,
			cert: pCertPem
		};
		if (pCaPem)
		{
			tmpOptions.ca = pCaPem;
		}
		return libTLS.createSecureContext(tmpOptions);
	}

	/**
	 * Insert or replace a hostname's SecureContext. `pHostname` may be
	 * either an exact hostname or a wildcard pattern starting with `*.`.
	 * If `pHostname === '*'` the entry becomes the default.
	 */
	updateContext(pHostname, pKeyPem, pCertPem, pCaPem)
	{
		let tmpContext = SSLProxyCertStore.buildContextPemPair(pKeyPem, pCertPem, pCaPem);
		let tmpRecord = { context: tmpContext, keyPem: pKeyPem, certPem: pCertPem, caPem: pCaPem || null };

		let tmpHostname = String(pHostname).toLowerCase();

		if (tmpHostname === '*')
		{
			this.defaultContext = tmpRecord;
			return;
		}

		if (tmpHostname.startsWith('*.'))
		{
			let tmpSuffix = tmpHostname.slice(1); // keep the leading dot
			// Replace any existing entry for the same suffix
			let tmpExisting = this.wildcardContexts.findIndex((pEntry) => pEntry.suffix === tmpSuffix);
			if (tmpExisting >= 0)
			{
				this.wildcardContexts[tmpExisting] = Object.assign({ suffix: tmpSuffix }, tmpRecord);
			}
			else
			{
				this.wildcardContexts.push(Object.assign({ suffix: tmpSuffix }, tmpRecord));
			}
			this.wildcardContexts.sort((pLeft, pRight) => pRight.suffix.length - pLeft.suffix.length);
			return;
		}

		this.exactContexts.set(tmpHostname, tmpRecord);

		// If no explicit default has been set yet, use the first real cert.
		if (!this.defaultContext)
		{
			this.defaultContext = tmpRecord;
		}
	}

	/**
	 * Lookup used by the HTTPS server's SNI callback.
	 *
	 * @param {string} pServername - the SNI hostname sent by the client
	 * @returns {tls.SecureContext|null}
	 */
	getSecureContext(pServername)
	{
		if (typeof (pServername) === 'string' && pServername.length > 0)
		{
			let tmpServername = pServername.toLowerCase();
			let tmpExact = this.exactContexts.get(tmpServername);
			if (tmpExact)
			{
				return tmpExact.context;
			}

			for (let tmpWildcard of this.wildcardContexts)
			{
				if (tmpServername.endsWith(tmpWildcard.suffix) && tmpServername.length > tmpWildcard.suffix.length)
				{
					return tmpWildcard.context;
				}
			}
		}

		if (this.defaultContext)
		{
			return this.defaultContext.context;
		}
		return null;
	}

	/**
	 * Default cert/key PEMs used when constructing `https.createServer()` —
	 * Node requires an initial cert even when SNICallback is also provided
	 * (to handle non-SNI clients).
	 */
	getDefaultKeyPem()
	{
		return this.defaultContext ? this.defaultContext.keyPem : null;
	}

	getDefaultCertPem()
	{
		return this.defaultContext ? this.defaultContext.certPem : null;
	}

	/**
	 * Return a summary of loaded certs for diagnostics.
	 */
	describe()
	{
		let tmpDescription =
		{
			default: this.defaultContext ? true : false,
			exact: Array.from(this.exactContexts.keys()),
			wildcard: this.wildcardContexts.map((pEntry) => `*${pEntry.suffix}`)
		};
		return tmpDescription;
	}
}

module.exports = SSLProxyCertStore;
