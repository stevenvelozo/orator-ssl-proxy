/**
* Unit tests for SSL Proxy Configuration Loader
*
* @license     MIT
*
* @author      Steven Velozo <steven@velozo.com>
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libLoader = require('../source/config/SSL-Proxy-Configuration-Loader.js');

const minimalConfig =
	{
		certs: { strategy: 'selfsigned' },
		routes: [{ host: 'awesomeapp.localhost', target: 'http://127.0.0.1:8086' }]
	};

suite
(
	'SSL Proxy Configuration Loader',
	() =>
	{
		suite
		(
			'deepMerge',
			() =>
			{
				test
				(
					'merges nested objects key-by-key',
					() =>
					{
						let tmpMerged = libLoader.deepMerge(
							{ a: { b: 1, c: 2 }, x: 1 },
							{ a: { c: 3, d: 4 }, y: 2 });
						Expect(tmpMerged).to.deep.equal({ a: { b: 1, c: 3, d: 4 }, x: 1, y: 2 });
					}
				);
				test
				(
					'arrays in the override replace the base entry',
					() =>
					{
						let tmpMerged = libLoader.deepMerge(
							{ routes: [{ host: 'a', target: 'ta' }] },
							{ routes: [{ host: 'b', target: 'tb' }] });
						Expect(tmpMerged.routes).to.have.length(1);
						Expect(tmpMerged.routes[0].host).to.equal('b');
					}
				);
				test
				(
					'null override leaves the base untouched',
					() =>
					{
						Expect(libLoader.deepMerge({ a: 1 }, null)).to.deep.equal({ a: 1 });
					}
				);
			});

		suite
		(
			'normalise',
			() =>
			{
				test
				(
					'fills in missing defaults',
					() =>
					{
						let tmpCfg = libLoader.normalise(minimalConfig);
						Expect(tmpCfg.https).to.be.an('object');
						Expect(tmpCfg.http).to.be.an('object');
						Expect(tmpCfg.certs.selfsigned.mode).to.equal('localCA');
						Expect(tmpCfg.logging).to.be.an('object');
					}
				);
				test
				(
					'resolves hashed default ports when not supplied',
					() =>
					{
						let tmpCfg = libLoader.normalise(minimalConfig);
						Expect(tmpCfg.https.port).to.be.at.least(13000);
						Expect(tmpCfg.https.port).to.be.below(15000);
						Expect(tmpCfg.http.port).to.be.at.least(15000);
						Expect(tmpCfg.http.port).to.be.below(17000);
					}
				);
				test
				(
					'preserves explicit ports',
					() =>
					{
						let tmpCfg = libLoader.normalise(
							{
								https: { port: 8443 },
								http: { port: 8080 },
								certs: { strategy: 'selfsigned' },
								routes: [{ host: 'a.test', target: 'http://127.0.0.1:9000' }]
							});
						Expect(tmpCfg.https.port).to.equal(8443);
						Expect(tmpCfg.http.port).to.equal(8080);
					}
				);
				test
				(
					'lowercases route hostnames and defaults ws:true',
					() =>
					{
						let tmpCfg = libLoader.normalise(
							{
								certs: { strategy: 'selfsigned' },
								routes: [{ host: 'MY.APP.Test', target: 'http://127.0.0.1:9000' }]
							});
						Expect(tmpCfg.routes[0].host).to.equal('my.app.test');
						Expect(tmpCfg.routes[0].ws).to.equal(true);
					}
				);
			});

		suite
		(
			'validate',
			() =>
			{
				test
				(
					'valid config returns no errors',
					() =>
					{
						let tmpCfg = libLoader.normalise(minimalConfig);
						let tmpErrors = libLoader.validate(tmpCfg);
						Expect(tmpErrors).to.be.an('array').that.is.empty;
					}
				);
				test
				(
					'rejects unknown strategy',
					() =>
					{
						let tmpCfg = libLoader.normalise(
							{
								certs: { strategy: 'wat' },
								routes: [{ host: 'a', target: 'http://127.0.0.1:9000' }]
							});
						let tmpErrors = libLoader.validate(tmpCfg);
						Expect(tmpErrors.length).to.be.above(0);
						Expect(tmpErrors.join('\n')).to.include('certs.strategy');
					}
				);
				test
				(
					'requires letsencrypt email when strategy is letsencrypt',
					() =>
					{
						let tmpCfg = libLoader.normalise(
							{
								certs: { strategy: 'letsencrypt' },
								routes: [{ host: 'a.test', target: 'http://127.0.0.1:9000' }]
							});
						let tmpErrors = libLoader.validate(tmpCfg);
						Expect(tmpErrors.join('\n')).to.include('letsencrypt.email');
					}
				);
				test
				(
					'rejects route entries missing host or target',
					() =>
					{
						let tmpCfg = libLoader.normalise(
							{
								certs: { strategy: 'selfsigned' },
								routes: [{ host: 'a.test' }, { target: 'http://127.0.0.1:9000' }]
							});
						let tmpErrors = libLoader.validate(tmpCfg);
						Expect(tmpErrors.length).to.be.at.least(2);
					}
				);
				test
				(
					'rejects config with no routes and no default',
					() =>
					{
						let tmpCfg = libLoader.normalise(
							{
								certs: { strategy: 'selfsigned' },
								routes: []
							});
						let tmpErrors = libLoader.validate(tmpCfg);
						Expect(tmpErrors.join('\n')).to.include('at least one route');
					}
				);
				test
				(
					'accepts empty routes when default.target is set',
					() =>
					{
						let tmpCfg = libLoader.normalise(
							{
								certs: { strategy: 'selfsigned' },
								routes: [],
								default: { target: 'http://127.0.0.1:8080' }
							});
						let tmpErrors = libLoader.validate(tmpCfg);
						Expect(tmpErrors).to.be.an('array').that.is.empty;
					}
				);
			});

		suite
		(
			'load (one-shot)',
			() =>
			{
				test
				(
					'throws on invalid config',
					() =>
					{
						Expect(() => libLoader.load({ certs: { strategy: 'nope' } })).to.throw(Error);
					}
				);
				test
				(
					'returns normalised config on valid input',
					() =>
					{
						let tmpCfg = libLoader.load(minimalConfig);
						Expect(tmpCfg.certs.strategy).to.equal('selfsigned');
						Expect(tmpCfg.routes).to.have.length(1);
					}
				);
			});
	});
