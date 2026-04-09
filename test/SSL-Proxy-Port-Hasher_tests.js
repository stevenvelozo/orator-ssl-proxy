/**
* Unit tests for SSL Proxy Port Hasher
*
* @license     MIT
*
* @author      Steven Velozo <steven@velozo.com>
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libPortHasher = require('../source/util/SSL-Proxy-Port-Hasher.js');

suite
(
	'SSL Proxy Port Hasher',
	() =>
	{
		test
		(
			'produces the same port for the same input (determinism)',
			() =>
			{
				let tmpA = libPortHasher.hashPackageNameToPort('orator-ssl-proxy');
				let tmpB = libPortHasher.hashPackageNameToPort('orator-ssl-proxy');
				Expect(tmpA).to.equal(tmpB);
			}
		);

		test
		(
			'stays within the default range [13000, 17000)',
			() =>
			{
				for (let tmpName of ['orator-ssl-proxy', 'retold-remote', 'ultravisor', 'foo', 'x'.repeat(100)])
				{
					let tmpPort = libPortHasher.hashPackageNameToPort(tmpName);
					Expect(tmpPort).to.be.at.least(13000);
					Expect(tmpPort).to.be.below(17000);
				}
			}
		);

		test
		(
			'honours custom base and range',
			() =>
			{
				let tmpPort = libPortHasher.hashPackageNameToPort('anything', 20000, 1000);
				Expect(tmpPort).to.be.at.least(20000);
				Expect(tmpPort).to.be.below(21000);
			}
		);

		test
		(
			'different inputs produce different ports (usually)',
			() =>
			{
				// Not guaranteed, but extremely likely for these distinct strings.
				let tmpA = libPortHasher.hashPackageNameToPort('alpha');
				let tmpB = libPortHasher.hashPackageNameToPort('beta');
				Expect(tmpA).to.not.equal(tmpB);
			}
		);

		test
		(
			'HTTPS and HTTP pair are in non-overlapping ranges',
			() =>
			{
				let tmpPorts = libPortHasher.hashPackageNameToHTTPSAndHTTPPorts('orator-ssl-proxy');
				Expect(tmpPorts).to.have.property('httpsPort');
				Expect(tmpPorts).to.have.property('httpPort');
				Expect(tmpPorts.httpsPort).to.be.at.least(13000);
				Expect(tmpPorts.httpsPort).to.be.below(15000);
				Expect(tmpPorts.httpPort).to.be.at.least(15000);
				Expect(tmpPorts.httpPort).to.be.below(17000);
				Expect(tmpPorts.httpsPort).to.not.equal(tmpPorts.httpPort);
			}
		);
	});
