/**
* Unit tests for SSL Proxy Local CA helpers (node-forge based)
*
* @license     MIT
*
* @author      Steven Velozo <steven@velozo.com>
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libCrypto = require('crypto');
const libFS = require('fs');
const libOS = require('os');
const libPath = require('path');

const libLocalCA = require('../source/certs/SSL-Proxy-LocalCA.js');

suite
(
	'SSL Proxy Local CA',
	() =>
	{
		test
		(
			'generates a CA with basicConstraints CA=true',
			function ()
			{
				this.timeout(30000);
				let tmpCA = libLocalCA.generateCA({ commonName: 'Test CA', validityYears: 1, keySize: 2048 });
				Expect(tmpCA).to.have.property('keyPem');
				Expect(tmpCA).to.have.property('certPem');
				Expect(tmpCA.keyPem).to.include('BEGIN RSA PRIVATE KEY');
				Expect(tmpCA.certPem).to.include('BEGIN CERTIFICATE');
				// Parse with node's X509Certificate for the strongest assertions
				let tmpX509 = new libCrypto.X509Certificate(tmpCA.certPem);
				Expect(tmpX509.ca).to.equal(true);
				Expect(tmpX509.subject).to.include('Test CA');
				// Self-issued
				Expect(tmpX509.issuer).to.equal(tmpX509.subject);
			}
		);

		test
		(
			'generates a leaf cert signed by the CA with SANs',
			function ()
			{
				this.timeout(30000);
				let tmpCA = libLocalCA.generateCA({ commonName: 'Test CA', validityYears: 1, keySize: 2048 });
				let tmpLeaf = libLocalCA.generateLeaf(
					{
						caKeyPem: tmpCA.keyPem,
						caCertPem: tmpCA.certPem,
						hostname: 'leaf.example.com',
						validityDays: 30,
						keySize: 2048
					});
				let tmpCACert = new libCrypto.X509Certificate(tmpCA.certPem);
				let tmpLeafCert = new libCrypto.X509Certificate(tmpLeaf.certPem);

				Expect(tmpLeafCert.ca).to.equal(false);
				Expect(tmpLeafCert.subject).to.include('leaf.example.com');
				Expect(tmpLeafCert.issuer).to.equal(tmpCACert.subject);

				// subjectAltName must include the hostname + localhost + loopback
				let tmpSAN = tmpLeafCert.subjectAltName || '';
				Expect(tmpSAN).to.include('leaf.example.com');
				Expect(tmpSAN).to.include('localhost');
				Expect(tmpSAN).to.include('127.0.0.1');

				// Verify the leaf is signed by the CA's key
				Expect(tmpLeafCert.verify(tmpCACert.publicKey)).to.equal(true);
			}
		);

		test
		(
			'loadOrGenerateCA persists and reuses on second call',
			function ()
			{
				this.timeout(30000);
				let tmpTempBase = libFS.mkdtempSync(libPath.join(libOS.tmpdir(), 'orator-ssl-ca-'));

				let tmpFirst = libLocalCA.loadOrGenerateCA(
					{
						storagePath: tmpTempBase,
						commonName: 'Persisted CA',
						validityYears: 1,
						keySize: 2048
					});
				Expect(tmpFirst.created).to.equal(true);

				let tmpSecond = libLocalCA.loadOrGenerateCA(
					{
						storagePath: tmpTempBase,
						commonName: 'Persisted CA',
						validityYears: 1,
						keySize: 2048
					});
				Expect(tmpSecond.created).to.equal(false);
				Expect(tmpSecond.certPem).to.equal(tmpFirst.certPem);
				Expect(tmpSecond.keyPem).to.equal(tmpFirst.keyPem);

				// Cleanup
				libFS.rmSync(tmpTempBase, { recursive: true, force: true });
			}
		);

		test
		(
			'generateAdhocSelfSigned produces a usable cert with SANs',
			function ()
			{
				this.timeout(30000);
				let tmpResult = libLocalCA.generateAdhocSelfSigned(
					{ hostname: 'adhoc.example.com', validityDays: 30, keySize: 2048 });
				let tmpCert = new libCrypto.X509Certificate(tmpResult.certPem);
				Expect(tmpCert.subject).to.include('adhoc.example.com');
				Expect(tmpCert.issuer).to.equal(tmpCert.subject);
				Expect(tmpCert.subjectAltName || '').to.include('adhoc.example.com');
			}
		);
	});
