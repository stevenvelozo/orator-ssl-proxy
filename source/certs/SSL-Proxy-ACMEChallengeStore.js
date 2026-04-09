/**
 * Tiny shared map used by the Let's Encrypt strategy and the port-80 HTTP
 * listener to coordinate HTTP-01 challenge responses.
 *
 * The strategy calls `set(token, keyAuth)` before requesting a cert and
 * `remove(token)` after it finishes; the HTTP listener reads with `get()`
 * when a request arrives at `/.well-known/acme-challenge/<token>`.
 */
class SSLProxyACMEChallengeStore
{
	constructor()
	{
		this.tokens = new Map();
	}

	set(pToken, pKeyAuthorization)
	{
		this.tokens.set(pToken, pKeyAuthorization);
	}

	get(pToken)
	{
		return this.tokens.get(pToken) || null;
	}

	remove(pToken)
	{
		this.tokens.delete(pToken);
	}

	clear()
	{
		this.tokens.clear();
	}

	size()
	{
		return this.tokens.size;
	}
}

module.exports = SSLProxyACMEChallengeStore;
