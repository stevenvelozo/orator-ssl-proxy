const libFS = require('fs');

const libSSLProxyCertStrategyBase = require('./SSL-Proxy-CertStrategy-Base.js');
const libLocalCA = require('./SSL-Proxy-LocalCA.js');

const LEAF_RENEW_THRESHOLD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Self-signed cert strategy with two sub-modes:
 *
 *   localCA (default, recommended) — generates a persistent local root CA
 *       on first boot, then signs per-host leaf certs off it. Users install
 *       the CA root into their OS trust store once via
 *       `orator-ssl-proxy cert-install-root-ca` and every leaf the proxy
 *       ever issues becomes automatically trusted by browsers.
 *
 *   adhoc — one-off standalone self-signed per host, no CA. Browser will
 *       always show a warning. Use for curl/automation contexts where
 *       nobody is looking at a browser.
 */
class SSLProxyCertStrategySelfSigned extends libSSLProxyCertStrategyBase
{
	constructor(pOptions)
	{
		super(pOptions);
		this.selfsignedConfig = this.config.certs.selfsigned || {};
		this.storagePath = this.config.certs.storagePath;

		// Cached CA PEMs for localCA mode
		this.caKeyPem = null;
		this.caCertPem = null;
	}

	get mode()
	{
		return this.selfsignedConfig.mode || 'localCA';
	}

	provision(fCallback)
	{
		try
		{
			let tmpHostnames = this.collectHostnames();

			// Always ensure at least the placeholder host `localhost` so the
			// HTTPS server has *something* to serve for non-SNI clients even
			// if no routes are configured yet.
			if (tmpHostnames.length === 0)
			{
				tmpHostnames = ['localhost'];
			}

			if (this.mode === 'localCA')
			{
				this.ensureLocalCA();
				for (let tmpHostname of tmpHostnames)
				{
					this.provisionLeafForHostname(tmpHostname);
				}
				if (this.log)
				{
					this.log.info(`selfsigned (localCA) provisioned ${tmpHostnames.length} leaf cert(s) from CA`);
					if (this.caCertPem)
					{
						let tmpNotAfter = libLocalCA.getNotAfter(this.caCertPem);
						this.log.info(`  CA expires: ${tmpNotAfter.toISOString()}`);
						this.warnIfCANearExpiry(tmpNotAfter);
					}
				}
			}
			else if (this.mode === 'adhoc')
			{
				libLocalCA.ensureDir(require('path').join(this.storagePath, 'selfsigned'));
				for (let tmpHostname of tmpHostnames)
				{
					this.provisionAdhocForHostname(tmpHostname);
				}
				if (this.log)
				{
					this.log.info(`selfsigned (adhoc) provisioned ${tmpHostnames.length} standalone cert(s) — browser warnings expected`);
				}
			}
			else
			{
				return fCallback(new Error(`unknown selfsigned mode: ${this.mode}`));
			}

			return fCallback(null);
		}
		catch (pError)
		{
			if (this.log)
			{
				this.log.error(`selfsigned strategy failed: ${pError.message}`, { Error: pError.message });
			}
			return fCallback(pError);
		}
	}

	ensureLocalCA()
	{
		let tmpResult = libLocalCA.loadOrGenerateCA(
			{
				storagePath: this.storagePath,
				commonName: this.selfsignedConfig.caCommonName,
				organization: this.selfsignedConfig.caOrganization,
				validityYears: this.selfsignedConfig.caValidityYears,
				keySize: this.selfsignedConfig.keySize
			});

		this.caKeyPem = tmpResult.keyPem;
		this.caCertPem = tmpResult.certPem;

		if (tmpResult.created && this.log)
		{
			let tmpPaths = libLocalCA.paths(this.storagePath);
			this.log.info(`generated new local CA at ${tmpPaths.caCertPath}`);
			this.log.info(`  run 'orator-ssl-proxy cert-install-root-ca' to install it into your OS trust store`);
		}
	}

	provisionLeafForHostname(pHostname)
	{
		let tmpPaths = libLocalCA.leafPaths(this.storagePath, pHostname);

		// Reuse existing leaf if it's still well within its validity window
		if (libFS.existsSync(tmpPaths.keyPath) && libFS.existsSync(tmpPaths.certPath))
		{
			try
			{
				let tmpKeyPem = libFS.readFileSync(tmpPaths.keyPath, 'utf8');
				let tmpCertPem = libFS.readFileSync(tmpPaths.certPath, 'utf8');
				let tmpNotAfter = libLocalCA.getNotAfter(tmpCertPem);
				let tmpDaysRemaining = (tmpNotAfter.getTime() - Date.now()) / MS_PER_DAY;
				if (tmpDaysRemaining > LEAF_RENEW_THRESHOLD_DAYS)
				{
					this.certStore.updateContext(pHostname, tmpKeyPem, tmpCertPem + '\n' + this.caCertPem, this.caCertPem);
					if (this.log)
					{
						this.log.debug(`selfsigned leaf [${pHostname}] loaded from cache (${Math.floor(tmpDaysRemaining)} days remaining)`);
					}
					return;
				}
			}
			catch (pError)
			{
				// Fall through to regenerate
			}
		}

		let tmpLeaf = libLocalCA.generateLeaf(
			{
				caKeyPem: this.caKeyPem,
				caCertPem: this.caCertPem,
				hostname: pHostname,
				validityDays: this.selfsignedConfig.leafValidityDays,
				keySize: this.selfsignedConfig.keySize
			});

		libLocalCA.atomicWrite(tmpPaths.keyPath, tmpLeaf.keyPem, 0o600);
		libLocalCA.atomicWrite(tmpPaths.certPath, tmpLeaf.certPem, 0o644);
		libLocalCA.atomicWrite(
			tmpPaths.metaPath,
			JSON.stringify(
				{
					hostname: pHostname,
					issuedAt: new Date().toISOString(),
					notBefore: tmpLeaf.notBefore.toISOString(),
					notAfter: tmpLeaf.notAfter.toISOString(),
					issuer: 'local CA'
				}, null, 2),
			0o644);

		// Build the full chain (leaf + CA) for the SecureContext so browsers
		// that already trust the CA can build a complete chain.
		this.certStore.updateContext(pHostname, tmpLeaf.keyPem, tmpLeaf.certPem + '\n' + this.caCertPem, this.caCertPem);

		if (this.log)
		{
			this.log.info(`selfsigned leaf [${pHostname}] issued (expires ${tmpLeaf.notAfter.toISOString()})`);
		}
	}

	provisionAdhocForHostname(pHostname)
	{
		let tmpPaths = libLocalCA.leafPaths(this.storagePath, `adhoc-${pHostname}`);

		if (libFS.existsSync(tmpPaths.keyPath) && libFS.existsSync(tmpPaths.certPath))
		{
			try
			{
				let tmpKeyPem = libFS.readFileSync(tmpPaths.keyPath, 'utf8');
				let tmpCertPem = libFS.readFileSync(tmpPaths.certPath, 'utf8');
				let tmpNotAfter = libLocalCA.getNotAfter(tmpCertPem);
				let tmpDaysRemaining = (tmpNotAfter.getTime() - Date.now()) / MS_PER_DAY;
				if (tmpDaysRemaining > LEAF_RENEW_THRESHOLD_DAYS)
				{
					this.certStore.updateContext(pHostname, tmpKeyPem, tmpCertPem, null);
					return;
				}
			}
			catch (pError)
			{
				// Fall through to regenerate
			}
		}

		let tmpGenerated = libLocalCA.generateAdhocSelfSigned(
			{
				hostname: pHostname,
				validityDays: this.selfsignedConfig.leafValidityDays,
				keySize: this.selfsignedConfig.keySize
			});

		libLocalCA.atomicWrite(tmpPaths.keyPath, tmpGenerated.keyPem, 0o600);
		libLocalCA.atomicWrite(tmpPaths.certPath, tmpGenerated.certPem, 0o644);
		libLocalCA.atomicWrite(
			tmpPaths.metaPath,
			JSON.stringify(
				{
					hostname: pHostname,
					mode: 'adhoc',
					issuedAt: new Date().toISOString(),
					notBefore: tmpGenerated.notBefore.toISOString(),
					notAfter: tmpGenerated.notAfter.toISOString()
				}, null, 2),
			0o644);

		this.certStore.updateContext(pHostname, tmpGenerated.keyPem, tmpGenerated.certPem, null);
	}

	warnIfCANearExpiry(pNotAfter)
	{
		// Only warn when the CA is within 1/10th of its configured validity
		// window. This avoids spurious warnings for short-lived test CAs.
		let tmpDaysRemaining = (pNotAfter.getTime() - Date.now()) / MS_PER_DAY;
		let tmpValidityYears = this.selfsignedConfig.caValidityYears || 10;
		let tmpThresholdDays = Math.max(30, Math.floor((tmpValidityYears * 365) / 10));
		if (tmpDaysRemaining < tmpThresholdDays)
		{
			if (this.log)
			{
				this.log.warn(`local CA has less than ${tmpThresholdDays} days of validity remaining (${Math.floor(tmpDaysRemaining)} days).`);
				this.log.warn(`  regenerate and reinstall the CA before it expires, or future leaf certs will not be trusted.`);
			}
		}
	}

	checkAndRenew(fCallback)
	{
		// Re-run provision; existing leaves within the renewal threshold will
		// be reissued, unchanged ones will be loaded from cache.
		return this.provision(fCallback);
	}
}

module.exports = SSLProxyCertStrategySelfSigned;
