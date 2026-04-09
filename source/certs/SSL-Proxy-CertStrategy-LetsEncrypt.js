const libFS = require('fs');
const libPath = require('path');

const libSSLProxyCertStrategyBase = require('./SSL-Proxy-CertStrategy-Base.js');
const libLocalCA = require('./SSL-Proxy-LocalCA.js');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Let's Encrypt cert strategy using HTTP-01 challenges via the `acme-client`
 * npm package.
 *
 * Responsibilities:
 *   1. Load or create an ACME account key on first boot
 *   2. For each unique hostname in the route table:
 *        - If a cached cert exists and is well within validity, use it
 *        - Otherwise request a new cert via `client.auto()`
 *   3. Write challenge tokens into the shared ACMEChallengeStore so the
 *      port-80 listener can answer `/.well-known/acme-challenge/<token>`
 *   4. Provide `checkAndRenew()` for the periodic renewal timer
 *
 * Port 80 must be reachable from the public internet for HTTP-01 to work.
 * The caller is responsible for making sure a port-80 listener with the
 * same challenge store is running before calling provision().
 */
class SSLProxyCertStrategyLetsEncrypt extends libSSLProxyCertStrategyBase
{
	constructor(pOptions)
	{
		super(pOptions);

		this.acmeChallengeStore = pOptions.acmeChallengeStore;
		this.leConfig = this.config.certs.letsencrypt || {};
		this.storagePath = this.config.certs.storagePath;
		this.leDirectory = libPath.join(this.storagePath, 'letsencrypt');

		this.acme = null;
		this.client = null;
		this.accountKeyPem = null;
	}

	paths(pHostname)
	{
		let tmpSafe = String(pHostname).replace(/[^a-z0-9._-]/gi, '_');
		return (
			{
				keyPath: libPath.join(this.leDirectory, `${tmpSafe}.key`),
				certPath: libPath.join(this.leDirectory, `${tmpSafe}.cert`),
				metaPath: libPath.join(this.leDirectory, `${tmpSafe}.meta.json`)
			});
	}

	directoryUrl()
	{
		if (this.leConfig.directoryUrl)
		{
			return this.leConfig.directoryUrl;
		}
		return (this.leConfig.staging !== false)
			? 'https://acme-staging-v02.api.letsencrypt.org/directory'
			: 'https://acme-v02.api.letsencrypt.org/directory';
	}

	provision(fCallback)
	{
		if (!this.leConfig.email)
		{
			return fCallback(new Error('certs.letsencrypt.email is required for the letsencrypt strategy'));
		}

		try
		{
			this.acme = require('acme-client');
		}
		catch (pError)
		{
			return fCallback(new Error(`acme-client is not installed: ${pError.message}`));
		}

		libLocalCA.ensureDir(this.leDirectory);

		let tmpHostnames = this.collectHostnames();

		// If bootstrapWithSelfSigned is on, start by seeding the cert store with
		// placeholder self-signed certs so the HTTPS server can boot immediately
		// and serve port 80 for the ACME HTTP-01 challenge.
		if (this.leConfig.bootstrapWithSelfSigned !== false)
		{
			for (let tmpHostname of tmpHostnames)
			{
				let tmpPlaceholder = libLocalCA.generateAdhocSelfSigned({ hostname: tmpHostname, validityDays: 1 });
				this.certStore.updateContext(tmpHostname, tmpPlaceholder.keyPem, tmpPlaceholder.certPem, null);
			}
			if (tmpHostnames.length === 0)
			{
				let tmpPlaceholder = libLocalCA.generateAdhocSelfSigned({ hostname: 'localhost', validityDays: 1 });
				this.certStore.updateContext('localhost', tmpPlaceholder.keyPem, tmpPlaceholder.certPem, null);
			}
		}

		this.ensureAccountKey((pError) =>
		{
			if (pError) return fCallback(pError);

			try
			{
				this.client = new this.acme.Client(
					{
						directoryUrl: this.directoryUrl(),
						accountKey: this.accountKeyPem
					});
			}
			catch (pClientError)
			{
				return fCallback(pClientError);
			}

			// Request (or load) a cert for each hostname sequentially.
			let tmpIndex = 0;
			let _next = () =>
			{
				if (tmpIndex >= tmpHostnames.length)
				{
					if (this.log)
					{
						this.log.info(`letsencrypt provisioned ${tmpHostnames.length} cert(s) from ${this.directoryUrl()}`);
					}
					return fCallback(null);
				}
				let tmpHostname = tmpHostnames[tmpIndex++];
				this.provisionCertForHostname(tmpHostname, (pHostError) =>
				{
					if (pHostError)
					{
						if (this.log)
						{
							this.log.error(`letsencrypt failed for ${tmpHostname}: ${pHostError.message}`, { Error: pHostError.message });
						}
						// Continue with the next hostname rather than aborting startup.
					}
					_next();
				});
			};
			_next();
		});
	}

	ensureAccountKey(fCallback)
	{
		let tmpPath = libPath.join(this.leDirectory, 'account.key');
		if (libFS.existsSync(tmpPath))
		{
			this.accountKeyPem = libFS.readFileSync(tmpPath, 'utf8');
			return fCallback(null);
		}
		this.acme.crypto.createPrivateKey().then(
			(pKey) =>
			{
				this.accountKeyPem = pKey.toString();
				libLocalCA.atomicWrite(tmpPath, this.accountKeyPem, 0o600);
				return fCallback(null);
			},
			(pError) =>
			{
				return fCallback(pError);
			});
	}

	/**
	 * Decide whether we have a cached cert we can reuse.
	 */
	cachedCertIsFresh(pHostname)
	{
		let tmpPaths = this.paths(pHostname);
		if (!libFS.existsSync(tmpPaths.keyPath) || !libFS.existsSync(tmpPaths.certPath))
		{
			return false;
		}
		try
		{
			let tmpCertPem = libFS.readFileSync(tmpPaths.certPath, 'utf8');
			let tmpNotAfter = libLocalCA.getNotAfter(tmpCertPem);
			let tmpDays = (tmpNotAfter.getTime() - Date.now()) / MS_PER_DAY;
			let tmpThreshold = this.leConfig.renewBeforeDays || 30;
			return tmpDays > tmpThreshold;
		}
		catch (pError)
		{
			return false;
		}
	}

	provisionCertForHostname(pHostname, fCallback)
	{
		let tmpPaths = this.paths(pHostname);

		if (this.cachedCertIsFresh(pHostname))
		{
			let tmpKeyPem = libFS.readFileSync(tmpPaths.keyPath, 'utf8');
			let tmpCertPem = libFS.readFileSync(tmpPaths.certPath, 'utf8');
			this.certStore.updateContext(pHostname, tmpKeyPem, tmpCertPem, null);
			if (this.log) this.log.info(`letsencrypt ${pHostname}: using cached cert`);
			return fCallback(null);
		}

		let tmpSelf = this;
		let _challengeCreateFn = (pAuthz, pChallenge, pKeyAuth) =>
		{
			if (pChallenge.type === 'http-01')
			{
				tmpSelf.acmeChallengeStore.set(pChallenge.token, pKeyAuth);
			}
			return Promise.resolve();
		};
		let _challengeRemoveFn = (pAuthz, pChallenge) =>
		{
			if (pChallenge.type === 'http-01')
			{
				tmpSelf.acmeChallengeStore.remove(pChallenge.token);
			}
			return Promise.resolve();
		};

		this.acme.crypto.createPrivateKey().then(
			(pKey) =>
			{
				let tmpKeyPem = pKey.toString();
				return tmpSelf.acme.crypto.createCsr(
					{
						commonName: pHostname,
						altNames: [pHostname]
					}, tmpKeyPem).then(
					([pCsrKey, pCsr]) =>
					{
						return tmpSelf.client.auto(
							{
								csr: pCsr,
								email: tmpSelf.leConfig.email,
								termsOfServiceAgreed: true,
								challengePriority: ['http-01'],
								challengeCreateFn: _challengeCreateFn,
								challengeRemoveFn: _challengeRemoveFn
							}).then(
							(pCertPem) =>
							{
								libLocalCA.atomicWrite(tmpPaths.keyPath, tmpKeyPem, 0o600);
								libLocalCA.atomicWrite(tmpPaths.certPath, pCertPem.toString(), 0o644);
								libLocalCA.atomicWrite(
									tmpPaths.metaPath,
									JSON.stringify(
										{
											hostname: pHostname,
											issuedAt: new Date().toISOString(),
											directoryUrl: tmpSelf.directoryUrl(),
											staging: (tmpSelf.leConfig.staging !== false)
										}, null, 2),
									0o644);

								tmpSelf.certStore.updateContext(pHostname, tmpKeyPem, pCertPem.toString(), null);
								if (tmpSelf.log)
								{
									tmpSelf.log.info(`letsencrypt ${pHostname}: issued`);
								}
								return fCallback(null);
							});
					});
			}).catch((pError) =>
			{
				return fCallback(pError);
			});
	}

	checkAndRenew(fCallback)
	{
		// Re-run provision — cached certs with enough validity will be skipped.
		return this.provision(fCallback);
	}
}

module.exports = SSLProxyCertStrategyLetsEncrypt;
