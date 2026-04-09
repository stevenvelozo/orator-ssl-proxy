const libFS = require('fs');
const libPath = require('path');
const libForge = require('node-forge');

/**
 * Local Certificate Authority helper for the selfsigned strategy's
 * `localCA` mode.
 *
 * Generates, persists, and reuses a long-lived root CA, then signs
 * short-lived per-hostname leaf certs off it. Everything is pure JS via
 * `node-forge` — no external binaries.
 *
 * Leaf certs always include a `subjectAltName` list containing the target
 * hostname plus `localhost`, `127.0.0.1`, and `::1`. This is mandatory —
 * every modern browser rejects CN-only certs.
 */
const libOratorSSLProxyLocalCA =
{
	/**
	 * Paths for the CA artifacts inside the cert storage directory.
	 */
	paths: function (pStoragePath)
	{
		let tmpRoot = libPath.join(pStoragePath, 'selfsigned');
		return (
			{
				root: tmpRoot,
				caKeyPath: libPath.join(tmpRoot, 'ca.key'),
				caCertPath: libPath.join(tmpRoot, 'ca.cert'),
				caMetaPath: libPath.join(tmpRoot, 'ca.meta.json')
			});
	},

	leafPaths: function (pStoragePath, pHostname)
	{
		let tmpRoot = libPath.join(pStoragePath, 'selfsigned');
		// Replace filesystem-unfriendly chars in hostname
		let tmpSafe = String(pHostname).replace(/[^a-z0-9._-]/gi, '_');
		return (
			{
				keyPath: libPath.join(tmpRoot, `${tmpSafe}.key`),
				certPath: libPath.join(tmpRoot, `${tmpSafe}.cert`),
				metaPath: libPath.join(tmpRoot, `${tmpSafe}.meta.json`)
			});
	},

	ensureDir: function (pDirectory)
	{
		if (!libFS.existsSync(pDirectory))
		{
			libFS.mkdirSync(pDirectory, { recursive: true, mode: 0o700 });
		}
	},

	atomicWrite: function (pPath, pContents, pMode)
	{
		let tmpTmp = `${pPath}.tmp`;
		libFS.writeFileSync(tmpTmp, pContents, { mode: pMode || 0o600 });
		libFS.renameSync(tmpTmp, pPath);
	},

	/**
	 * Randomish serial number as a positive hex string (non-zero leading nybble).
	 */
	randomSerial: function ()
	{
		let tmpBytes = libForge.random.getBytesSync(16);
		let tmpHex = libForge.util.bytesToHex(tmpBytes);
		// Force first nibble to be between 1 and 7 so the integer stays positive
		let tmpFirst = parseInt(tmpHex[0], 16) & 0x7;
		if (tmpFirst === 0) tmpFirst = 1;
		return tmpFirst.toString(16) + tmpHex.slice(1);
	},

	/**
	 * Generate a brand-new local root CA.
	 *
	 * @param {object} pOptions
	 * @param {string} pOptions.commonName
	 * @param {string} [pOptions.organization]
	 * @param {number} [pOptions.validityYears=10]
	 * @param {number} [pOptions.keySize=2048]
	 * @returns {{keyPem: string, certPem: string, notBefore: Date, notAfter: Date}}
	 */
	generateCA: function (pOptions)
	{
		let tmpKeyPair = libForge.pki.rsa.generateKeyPair({ bits: pOptions.keySize || 2048 });
		let tmpCert = libForge.pki.createCertificate();
		tmpCert.publicKey = tmpKeyPair.publicKey;
		tmpCert.serialNumber = libOratorSSLProxyLocalCA.randomSerial();
		tmpCert.validity.notBefore = new Date();
		tmpCert.validity.notAfter = new Date();
		tmpCert.validity.notAfter.setFullYear(tmpCert.validity.notBefore.getFullYear() + (pOptions.validityYears || 10));

		let tmpAttrs =
			[
				{ name: 'commonName', value: pOptions.commonName || 'Retold Orator SSL Proxy Local CA' },
				{ name: 'organizationName', value: pOptions.organization || 'Retold' },
				{ name: 'organizationalUnitName', value: 'orator-ssl-proxy' }
			];
		tmpCert.setSubject(tmpAttrs);
		tmpCert.setIssuer(tmpAttrs); // self-signed

		tmpCert.setExtensions(
			[
				{ name: 'basicConstraints', cA: true, critical: true },
				{
					name: 'keyUsage',
					critical: true,
					keyCertSign: true,
					cRLSign: true,
					digitalSignature: true
				},
				{ name: 'subjectKeyIdentifier' }
			]);

		tmpCert.sign(tmpKeyPair.privateKey, libForge.md.sha256.create());

		return (
			{
				keyPem: libForge.pki.privateKeyToPem(tmpKeyPair.privateKey),
				certPem: libForge.pki.certificateToPem(tmpCert),
				notBefore: tmpCert.validity.notBefore,
				notAfter: tmpCert.validity.notAfter
			});
	},

	/**
	 * Load the existing CA from disk, or generate and persist a new one.
	 *
	 * @returns {{keyPem: string, certPem: string, notBefore: Date, notAfter: Date, created: boolean}}
	 */
	loadOrGenerateCA: function (pOptions)
	{
		let tmpPaths = libOratorSSLProxyLocalCA.paths(pOptions.storagePath);
		libOratorSSLProxyLocalCA.ensureDir(tmpPaths.root);

		if (libFS.existsSync(tmpPaths.caKeyPath) && libFS.existsSync(tmpPaths.caCertPath))
		{
			let tmpKeyPem = libFS.readFileSync(tmpPaths.caKeyPath, 'utf8');
			let tmpCertPem = libFS.readFileSync(tmpPaths.caCertPath, 'utf8');
			let tmpParsed = libForge.pki.certificateFromPem(tmpCertPem);
			return (
				{
					keyPem: tmpKeyPem,
					certPem: tmpCertPem,
					notBefore: tmpParsed.validity.notBefore,
					notAfter: tmpParsed.validity.notAfter,
					created: false
				});
		}

		let tmpGenerated = libOratorSSLProxyLocalCA.generateCA(
			{
				commonName: pOptions.commonName,
				organization: pOptions.organization,
				validityYears: pOptions.validityYears,
				keySize: pOptions.keySize
			});

		libOratorSSLProxyLocalCA.atomicWrite(tmpPaths.caKeyPath, tmpGenerated.keyPem, 0o600);
		libOratorSSLProxyLocalCA.atomicWrite(tmpPaths.caCertPath, tmpGenerated.certPem, 0o644);
		libOratorSSLProxyLocalCA.atomicWrite(
			tmpPaths.caMetaPath,
			JSON.stringify(
				{
					commonName: pOptions.commonName || 'Retold Orator SSL Proxy Local CA',
					createdAt: new Date().toISOString(),
					notBefore: tmpGenerated.notBefore.toISOString(),
					notAfter: tmpGenerated.notAfter.toISOString()
				}, null, 2),
			0o644);

		return Object.assign(tmpGenerated, { created: true });
	},

	/**
	 * Sign a leaf certificate for a hostname using the provided CA PEMs.
	 *
	 * @param {object} pOptions
	 * @param {string} pOptions.caKeyPem
	 * @param {string} pOptions.caCertPem
	 * @param {string} pOptions.hostname
	 * @param {number} [pOptions.validityDays=365]
	 * @param {number} [pOptions.keySize=2048]
	 * @param {string[]} [pOptions.extraHostnames]
	 * @returns {{keyPem: string, certPem: string, notBefore: Date, notAfter: Date}}
	 */
	generateLeaf: function (pOptions)
	{
		let tmpCaKey = libForge.pki.privateKeyFromPem(pOptions.caKeyPem);
		let tmpCaCert = libForge.pki.certificateFromPem(pOptions.caCertPem);

		let tmpKeyPair = libForge.pki.rsa.generateKeyPair({ bits: pOptions.keySize || 2048 });
		let tmpCert = libForge.pki.createCertificate();
		tmpCert.publicKey = tmpKeyPair.publicKey;
		tmpCert.serialNumber = libOratorSSLProxyLocalCA.randomSerial();
		tmpCert.validity.notBefore = new Date();
		tmpCert.validity.notAfter = new Date();
		tmpCert.validity.notAfter.setDate(tmpCert.validity.notBefore.getDate() + (pOptions.validityDays || 365));

		tmpCert.setSubject(
			[
				{ name: 'commonName', value: pOptions.hostname },
				{ name: 'organizationName', value: 'Retold' }
			]);
		tmpCert.setIssuer(tmpCaCert.subject.attributes);

		// Build SAN list: always include localhost and loopback addresses
		// alongside the target hostname plus any extras.
		let tmpAltNames = [];
		let tmpAltHostnameSet = new Set();
		let tmpAdd = (pName) =>
		{
			let tmpLow = String(pName).toLowerCase();
			if (tmpAltHostnameSet.has(tmpLow)) return;
			tmpAltHostnameSet.add(tmpLow);
			tmpAltNames.push({ type: 2, value: pName }); // type 2 = DNS
		};
		tmpAdd(pOptions.hostname);
		if (Array.isArray(pOptions.extraHostnames))
		{
			for (let tmpExtra of pOptions.extraHostnames)
			{
				tmpAdd(tmpExtra);
			}
		}
		tmpAdd('localhost');
		tmpAltNames.push({ type: 7, ip: '127.0.0.1' }); // type 7 = IP
		tmpAltNames.push({ type: 7, ip: '::1' });

		tmpCert.setExtensions(
			[
				{ name: 'basicConstraints', cA: false },
				{
					name: 'keyUsage',
					critical: true,
					digitalSignature: true,
					keyEncipherment: true
				},
				{
					name: 'extKeyUsage',
					serverAuth: true,
					clientAuth: true
				},
				{ name: 'subjectAltName', altNames: tmpAltNames },
				{ name: 'subjectKeyIdentifier' }
			]);

		tmpCert.sign(tmpCaKey, libForge.md.sha256.create());

		return (
			{
				keyPem: libForge.pki.privateKeyToPem(tmpKeyPair.privateKey),
				certPem: libForge.pki.certificateToPem(tmpCert),
				notBefore: tmpCert.validity.notBefore,
				notAfter: tmpCert.validity.notAfter
			});
	},

	/**
	 * Generate a stand-alone self-signed cert (no CA). Used by the `adhoc`
	 * mode of the selfsigned strategy.
	 */
	generateAdhocSelfSigned: function (pOptions)
	{
		let tmpKeyPair = libForge.pki.rsa.generateKeyPair({ bits: pOptions.keySize || 2048 });
		let tmpCert = libForge.pki.createCertificate();
		tmpCert.publicKey = tmpKeyPair.publicKey;
		tmpCert.serialNumber = libOratorSSLProxyLocalCA.randomSerial();
		tmpCert.validity.notBefore = new Date();
		tmpCert.validity.notAfter = new Date();
		tmpCert.validity.notAfter.setDate(tmpCert.validity.notBefore.getDate() + (pOptions.validityDays || 365));

		let tmpAttrs =
			[
				{ name: 'commonName', value: pOptions.hostname },
				{ name: 'organizationName', value: 'Retold' }
			];
		tmpCert.setSubject(tmpAttrs);
		tmpCert.setIssuer(tmpAttrs); // self-signed

		let tmpAltNames =
			[
				{ type: 2, value: pOptions.hostname },
				{ type: 2, value: 'localhost' },
				{ type: 7, ip: '127.0.0.1' },
				{ type: 7, ip: '::1' }
			];

		tmpCert.setExtensions(
			[
				{ name: 'basicConstraints', cA: false },
				{
					name: 'keyUsage',
					critical: true,
					digitalSignature: true,
					keyEncipherment: true
				},
				{
					name: 'extKeyUsage',
					serverAuth: true
				},
				{ name: 'subjectAltName', altNames: tmpAltNames }
			]);

		tmpCert.sign(tmpKeyPair.privateKey, libForge.md.sha256.create());

		return (
			{
				keyPem: libForge.pki.privateKeyToPem(tmpKeyPair.privateKey),
				certPem: libForge.pki.certificateToPem(tmpCert),
				notBefore: tmpCert.validity.notBefore,
				notAfter: tmpCert.validity.notAfter
			});
	},

	/**
	 * Parse a cert PEM and return `notAfter`.
	 */
	getNotAfter: function (pCertPem)
	{
		let tmpParsed = libForge.pki.certificateFromPem(pCertPem);
		return tmpParsed.validity.notAfter;
	}
};

module.exports = libOratorSSLProxyLocalCA;
