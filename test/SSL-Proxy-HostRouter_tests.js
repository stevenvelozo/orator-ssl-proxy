/**
* Unit tests for SSL Proxy Host Router
*
* @license     MIT
*
* @author      Steven Velozo <steven@velozo.com>
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libHostRouter = require('../source/router/SSL-Proxy-HostRouter.js');

const tmpRoutes =
	[
		{ host: 'app-a.test',        target: 'http://127.0.0.1:9001' },
		{ host: 'app-b.test',        target: 'http://127.0.0.1:9002' },
		{ host: 'api.app-b.test',    target: 'http://127.0.0.1:9003' },
		{ host: '*.dev.example.com', target: 'http://127.0.0.1:9004' },
		{ host: '*.example.com',     target: 'http://127.0.0.1:9005' }
	];

suite
(
	'SSL Proxy Host Router',
	() =>
	{
		suite
		(
			'Host header normalisation',
			() =>
			{
				test
				(
					'strips trailing :port on a regular hostname',
					() =>
					{
						Expect(libHostRouter.normaliseHostHeader('foo.example.com:8443')).to.equal('foo.example.com');
					}
				);
				test
				(
					'lowercases the host header',
					() =>
					{
						Expect(libHostRouter.normaliseHostHeader('FOO.Example.COM')).to.equal('foo.example.com');
					}
				);
				test
				(
					'handles bracketed IPv6 literals',
					() =>
					{
						Expect(libHostRouter.normaliseHostHeader('[::1]:8443')).to.equal('[::1]');
					}
				);
				test
				(
					'returns empty string for empty input',
					() =>
					{
						Expect(libHostRouter.normaliseHostHeader('')).to.equal('');
						Expect(libHostRouter.normaliseHostHeader(undefined)).to.equal('');
					}
				);
			});

		suite
		(
			'Resolution',
			() =>
			{
				test
				(
					'resolves exact host match',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						let tmpResult = tmpRouter.resolve('app-a.test');
						Expect(tmpResult).to.be.an('object');
						Expect(tmpResult.target).to.equal('http://127.0.0.1:9001');
					}
				);
				test
				(
					'exact match beats wildcard match',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						let tmpResult = tmpRouter.resolve('app-a.test');
						Expect(tmpResult.host).to.equal('app-a.test');
					}
				);
				test
				(
					'resolves wildcard match',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						let tmpResult = tmpRouter.resolve('foo.example.com');
						Expect(tmpResult).to.be.an('object');
						Expect(tmpResult.target).to.equal('http://127.0.0.1:9005');
					}
				);
				test
				(
					'longest wildcard suffix wins',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						let tmpResult = tmpRouter.resolve('foo.dev.example.com');
						Expect(tmpResult.target).to.equal('http://127.0.0.1:9004');
					}
				);
				test
				(
					'strips :port from incoming host before matching',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						let tmpResult = tmpRouter.resolve('app-a.test:8443');
						Expect(tmpResult.target).to.equal('http://127.0.0.1:9001');
					}
				);
				test
				(
					'case-insensitive matching',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						let tmpResult = tmpRouter.resolve('APP-A.TEST');
						Expect(tmpResult.target).to.equal('http://127.0.0.1:9001');
					}
				);
				test
				(
					'returns default when no route matches',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, { target: 'http://127.0.0.1:9999' });
						let tmpResult = tmpRouter.resolve('unknown.localhost');
						Expect(tmpResult).to.be.an('object');
						Expect(tmpResult.target).to.equal('http://127.0.0.1:9999');
						Expect(tmpResult.isDefault).to.equal(true);
					}
				);
				test
				(
					'returns null when no route matches and no default',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						Expect(tmpRouter.resolve('unknown.localhost')).to.equal(null);
					}
				);
				test
				(
					'wildcard does not match parent domain itself',
					() =>
					{
						// *.example.com should not match "example.com"
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						Expect(tmpRouter.resolve('example.com')).to.equal(null);
					}
				);
			});

		suite
		(
			'Hostname collection',
			() =>
			{
				test
				(
					'returns exact hostnames only',
					() =>
					{
						let tmpRouter = new libHostRouter(null, tmpRoutes, null);
						let tmpHosts = tmpRouter.getCertHostnames();
						Expect(tmpHosts).to.include('app-a.test');
						Expect(tmpHosts).to.include('app-b.test');
						Expect(tmpHosts).to.include('api.app-b.test');
					}
				);
			});
	});
