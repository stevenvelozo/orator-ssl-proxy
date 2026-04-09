/**
 * Host-based request router.
 *
 * Resolves an incoming `Host` header to a backend route entry by walking
 * the configured routes list in priority order:
 *   1. Exact hostname match
 *   2. Longest wildcard match (e.g. `*.example.com` before `*.com`)
 *   3. Config default
 *   4. No match
 *
 * Matching is case-insensitive; any trailing `:port` suffix on the Host
 * header is stripped before comparison. Wildcards use a single leading
 * `*.` prefix — there is no glob expansion.
 */
class SSLProxyHostRouter
{
	/**
	 * @param {object} pFable - parent fable instance (for logging)
	 * @param {Array<{host: string, target: string, ws?: boolean, xfwd?: boolean}>} pRoutes
	 * @param {{target: string}|null} pDefaultRoute
	 */
	constructor(pFable, pRoutes, pDefaultRoute)
	{
		this.fable = pFable;
		this.log = pFable ? pFable.log : null;

		this.defaultRoute = pDefaultRoute || null;
		this.routes = [];
		this.setRoutes(pRoutes || []);
	}

	/**
	 * Replace the route table. Routes are split into exact and wildcard
	 * lists, with wildcard entries sorted longest-suffix-first so the most
	 * specific pattern wins.
	 */
	setRoutes(pRoutes)
	{
		this.exactRoutes = new Map();
		this.wildcardRoutes = [];

		for (let tmpRoute of pRoutes)
		{
			if (!tmpRoute || !tmpRoute.host || !tmpRoute.target)
			{
				continue;
			}
			let tmpHost = String(tmpRoute.host).toLowerCase();
			let tmpEntry = Object.assign({}, tmpRoute, { host: tmpHost });

			if (tmpHost.startsWith('*.'))
			{
				let tmpSuffix = tmpHost.slice(1); // keep the leading dot, strip the star
				this.wildcardRoutes.push({ suffix: tmpSuffix, entry: tmpEntry });
			}
			else
			{
				this.exactRoutes.set(tmpHost, tmpEntry);
			}
		}

		// Longest suffix first (most specific wins)
		this.wildcardRoutes.sort((pLeft, pRight) => pRight.suffix.length - pLeft.suffix.length);

		this.routes = pRoutes.slice();
	}

	/**
	 * Strip a trailing `:port` from a Host header value and lowercase it.
	 * IPv6 literals in brackets are preserved.
	 */
	static normaliseHostHeader(pHost)
	{
		if (typeof (pHost) !== 'string' || pHost.length < 1)
		{
			return '';
		}
		let tmpHost = pHost.toLowerCase().trim();

		// IPv6 bracketed form: [::1]:8443 → [::1]
		if (tmpHost.startsWith('['))
		{
			let tmpClose = tmpHost.indexOf(']');
			if (tmpClose !== -1)
			{
				return tmpHost.slice(0, tmpClose + 1);
			}
			return tmpHost;
		}

		// Regular hostname: strip single trailing :port
		let tmpColon = tmpHost.lastIndexOf(':');
		if (tmpColon !== -1 && tmpHost.indexOf(':') === tmpColon)
		{
			return tmpHost.slice(0, tmpColon);
		}

		return tmpHost;
	}

	/**
	 * Resolve a Host header to a route entry, or the default, or null.
	 *
	 * @param {string} pHostHeader
	 * @returns {object|null} a route entry with {host, target, ws, xfwd, ...}
	 *   or the default route (with {target, ...}) or null if nothing matches
	 */
	resolve(pHostHeader)
	{
		let tmpHost = SSLProxyHostRouter.normaliseHostHeader(pHostHeader);

		if (tmpHost.length > 0)
		{
			let tmpExact = this.exactRoutes.get(tmpHost);
			if (tmpExact)
			{
				return tmpExact;
			}

			for (let tmpWildcard of this.wildcardRoutes)
			{
				if (tmpHost.endsWith(tmpWildcard.suffix) && tmpHost.length > tmpWildcard.suffix.length)
				{
					return tmpWildcard.entry;
				}
			}
		}

		if (this.defaultRoute && this.defaultRoute.target)
		{
			return { host: '*', target: this.defaultRoute.target, ws: true, isDefault: true };
		}

		return null;
	}

	/**
	 * Return the set of unique hostnames in the route table that should get
	 * real certs provisioned. Wildcard entries are excluded (wildcard certs
	 * require DNS-01 challenge which is out of scope for v1) — callers who
	 * want certs for wildcard patterns must list concrete hostnames in
	 * `certs.hostnames`.
	 */
	getCertHostnames()
	{
		let tmpHosts = new Set();
		for (let tmpHost of this.exactRoutes.keys())
		{
			tmpHosts.add(tmpHost);
		}
		return Array.from(tmpHosts);
	}

	/**
	 * Return the list of wildcard suffixes in use, for diagnostics.
	 */
	getWildcardSuffixes()
	{
		return this.wildcardRoutes.map((pEntry) => `*${pEntry.suffix}`);
	}
}

module.exports = SSLProxyHostRouter;
