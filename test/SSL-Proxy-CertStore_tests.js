/**
* Unit tests for SSL Proxy Cert Store
*
* @license     MIT
*
* @author      Steven Velozo <steven@velozo.com>
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libCertStore = require('../source/certs/SSL-Proxy-CertStore.js');
const libLocalCA = require('../source/certs/SSL-Proxy-LocalCA.js');

// One-shot CA + leaf pair shared by all tests
let _CA = null;
let _LeafA = null;
let _LeafB = null;

function ensureFixtures()
{
	if (_CA) return;
	_CA = libLocalCA.generateCA({ commonName: 'test CA', validityYears: 1, keySize: 2048 });
	_LeafA = libLocalCA.generateLeaf({
		caKeyPem: _CA.keyPem, caCertPem: _CA.certPem, hostname: 'alpha.test', validityDays: 30, keySize: 2048 });
	_LeafB = libLocalCA.generateLeaf({
		caKeyPem: _CA.keyPem, caCertPem: _CA.certPem, hostname: 'beta.test', validityDays: 30, keySize: 2048 });
}

suite
(
	'SSL Proxy Cert Store',
	() =>
	{
		test
		(
			'starts empty',
			() =>
			{
				let tmpStore = new libCertStore(null);
				Expect(tmpStore.getSecureContext('anything.test')).to.equal(null);
			}
		);

		test
		(
			'updateContext + getSecureContext round-trip by exact hostname',
			function ()
			{
				this.timeout(15000);
				ensureFixtures();
				let tmpStore = new libCertStore(null);
				tmpStore.updateContext('alpha.test', _LeafA.keyPem, _LeafA.certPem, _CA.certPem);
				Expect(tmpStore.getSecureContext('alpha.test')).to.be.an('object');
			}
		);

		test
		(
			'case-insensitive lookup',
			function ()
			{
				this.timeout(15000);
				ensureFixtures();
				let tmpStore = new libCertStore(null);
				tmpStore.updateContext('alpha.test', _LeafA.keyPem, _LeafA.certPem, _CA.certPem);
				Expect(tmpStore.getSecureContext('ALPHA.TEST')).to.be.an('object');
			}
		);

		test
		(
			'first cert inserted becomes the default',
			function ()
			{
				this.timeout(15000);
				ensureFixtures();
				let tmpStore = new libCertStore(null);
				tmpStore.updateContext('alpha.test', _LeafA.keyPem, _LeafA.certPem, _CA.certPem);
				Expect(tmpStore.getDefaultKeyPem()).to.equal(_LeafA.keyPem);
				Expect(tmpStore.getDefaultCertPem()).to.equal(_LeafA.certPem);
			}
		);

		test
		(
			'unknown hostnames fall back to the default',
			function ()
			{
				this.timeout(15000);
				ensureFixtures();
				let tmpStore = new libCertStore(null);
				tmpStore.updateContext('alpha.test', _LeafA.keyPem, _LeafA.certPem, _CA.certPem);
				Expect(tmpStore.getSecureContext('unknown.test')).to.be.an('object');
			}
		);

		test
		(
			'updateContext replaces the existing entry for a host',
			function ()
			{
				this.timeout(15000);
				ensureFixtures();
				let tmpStore = new libCertStore(null);
				tmpStore.updateContext('alpha.test', _LeafA.keyPem, _LeafA.certPem, _CA.certPem);
				tmpStore.updateContext('alpha.test', _LeafB.keyPem, _LeafB.certPem, _CA.certPem);
				// Second write is a different set of PEMs
				Expect(tmpStore.exactContexts.get('alpha.test').certPem).to.equal(_LeafB.certPem);
			}
		);

		test
		(
			'describe() returns a summary of what\'s loaded',
			function ()
			{
				this.timeout(15000);
				ensureFixtures();
				let tmpStore = new libCertStore(null);
				tmpStore.updateContext('alpha.test', _LeafA.keyPem, _LeafA.certPem, _CA.certPem);
				tmpStore.updateContext('beta.test', _LeafB.keyPem, _LeafB.certPem, _CA.certPem);
				let tmpDescription = tmpStore.describe();
				Expect(tmpDescription.default).to.equal(true);
				Expect(tmpDescription.exact).to.include('alpha.test');
				Expect(tmpDescription.exact).to.include('beta.test');
			}
		);
	});
