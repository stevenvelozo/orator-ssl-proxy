/**
 * Derives deterministic default ports for orator-ssl-proxy from a package
 * name. Hashing the name keeps local dev servers from colliding across
 * Retold modules and picks a port in the user-allocable high range so no
 * privileged binding is required on macOS/Linux.
 *
 * Uses a djb2-style hash so the output is stable across Node versions and
 * trivially portable if we ever need to compute the same port from a shell
 * script.
 */
const libOratorSSLProxyPortHasher =
{
	/**
	 * Hash a package name into a deterministic high port in [pBase, pBase + pRange).
	 *
	 * @param {string} pPackageName - the string to hash
	 * @param {number} [pBase=13000] - the bottom of the output range
	 * @param {number} [pRange=4000] - the width of the output range
	 * @returns {number}
	 */
	hashPackageNameToPort: function (pPackageName, pBase, pRange)
	{
		let tmpBase = (typeof (pBase) === 'number') ? pBase : 13000;
		let tmpRange = (typeof (pRange) === 'number') ? pRange : 4000;

		let tmpHash = 0;
		for (let i = 0; i < pPackageName.length; i++)
		{
			// (hash * 31 + charCode), 32-bit signed via bitwise ops
			tmpHash = ((tmpHash << 5) - tmpHash) + pPackageName.charCodeAt(i);
			tmpHash = tmpHash | 0;
		}

		return tmpBase + (Math.abs(tmpHash) % tmpRange);
	},

	/**
	 * Pick two deterministic non-overlapping ports for HTTPS and HTTP given a
	 * single package name seed. HTTPS lives in 13000-14999, HTTP in 15000-16999.
	 *
	 * @param {string} pPackageName
	 * @returns {{ httpsPort: number, httpPort: number }}
	 */
	hashPackageNameToHTTPSAndHTTPPorts: function (pPackageName)
	{
		return (
			{
				httpsPort: libOratorSSLProxyPortHasher.hashPackageNameToPort(pPackageName, 13000, 2000),
				httpPort: libOratorSSLProxyPortHasher.hashPackageNameToPort(pPackageName + ':http', 15000, 2000)
			});
	}
};

module.exports = libOratorSSLProxyPortHasher;
