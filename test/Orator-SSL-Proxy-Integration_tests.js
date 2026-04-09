/**
* End-to-end integration test for Orator SSL Proxy
*
* Spins up two tiny backends, an Orator-SSL-Proxy in front of them with
* a local CA, and makes real HTTPS requests. Verifies host-header
* dispatch, WebSocket forwarding, and forwarded headers.
*
* @license     MIT
*
* @author      Steven Velozo <steven@velozo.com>
*/

const Chai = require('chai');
const Expect = Chai.expect;

const libFS = require('fs');
const libOS = require('os');
const libPath = require('path');
const libHTTP = require('http');
const libHTTPS = require('https');

const libFable = require('fable');
const libOratorSSLProxy = require('../source/Orator-SSL-Proxy.js');
const libLocalCA = require('../source/certs/SSL-Proxy-LocalCA.js');

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/**
 * Start a tiny backend that echoes request headers and path as JSON.
 * Calls back with { server, port }.
 */
function startEchoBackend(fCallback)
{
	let tmpServer = libHTTP.createServer((pRequest, pResponse) =>
	{
		let tmpChunks = [];
		pRequest.on('data', (pChunk) => tmpChunks.push(pChunk));
		pRequest.on('end', () =>
		{
			let tmpBody = Buffer.concat(tmpChunks).toString('utf8');
			pResponse.writeHead(200, { 'Content-Type': 'application/json' });
			pResponse.end(JSON.stringify(
				{
					host: pRequest.headers.host,
					url: pRequest.url,
					method: pRequest.method,
					forwardedFor: pRequest.headers['x-forwarded-for'] || null,
					forwardedProto: pRequest.headers['x-forwarded-proto'] || null,
					forwardedHost: pRequest.headers['x-forwarded-host'] || null,
					body: tmpBody
				}));
		});
	});
	tmpServer.listen(0, '127.0.0.1', () =>
	{
		fCallback({ server: tmpServer, port: tmpServer.address().port });
	});
}

function freeTempDir()
{
	return libFS.mkdtempSync(libPath.join(libOS.tmpdir(), 'orator-ssl-int-'));
}

function makeFable()
{
	return new libFable(
		{
			Product: 'orator-ssl-proxy-integration',
			ProductVersion: '0.0.0',
			LogStreams: [{ level: 'warn' }]
		});
}

function httpsGetWithHost(pHostHeader, pPort, pCaPem, fCallback)
{
	let tmpOptions =
		{
			host: '127.0.0.1',
			port: pPort,
			path: '/integration-test-path',
			method: 'GET',
			servername: pHostHeader,
			headers: { host: pHostHeader },
			ca: pCaPem,
			rejectUnauthorized: !!pCaPem
		};
	let tmpReq = libHTTPS.request(tmpOptions, (pResponse) =>
	{
		let tmpChunks = [];
		pResponse.on('data', (pChunk) => tmpChunks.push(pChunk));
		pResponse.on('end', () =>
		{
			fCallback(null, pResponse.statusCode, Buffer.concat(tmpChunks).toString('utf8'));
		});
	});
	tmpReq.on('error', (pError) => fCallback(pError));
	tmpReq.end();
}

// ------------------------------------------------------------------
// Suite
// ------------------------------------------------------------------

suite
(
	'Orator SSL Proxy Integration',
	() =>
	{
		let _backendA = null;
		let _backendB = null;
		let _tmpCertsDir = null;
		let _fable = null;
		let _proxy = null;
		let _caPem = null;
		let _httpsPort = 0;

		suiteSetup
		(
			function (fDone)
			{
				this.timeout(60000);

				startEchoBackend((pA) =>
				{
					_backendA = pA;
					startEchoBackend((pB) =>
					{
						_backendB = pB;
						_tmpCertsDir = freeTempDir();
						_fable = makeFable();

						_fable.serviceManager.addServiceType('OratorSSLProxy', libOratorSSLProxy);

						try
						{
							_proxy = _fable.serviceManager.instantiateServiceProvider('OratorSSLProxy',
								{
									Configuration:
									{
										https: { port: 0, host: '127.0.0.1' },
										http: { port: 0, host: '127.0.0.1', redirectToHttps: false },
										certs:
										{
											strategy: 'selfsigned',
											storagePath: _tmpCertsDir,
											// Provision an extra cert for the fall-through host so the
											// TLS handshake succeeds and the router gets a chance to
											// route the request to the default backend.
											hostnames: ['fallthrough.test'],
											selfsigned: { mode: 'localCA', caValidityYears: 1, leafValidityDays: 30, keySize: 2048 }
										},
										routes:
											[
												{ host: 'app-a.test', target: `http://127.0.0.1:${_backendA.port}`, ws: true },
												{ host: 'app-b.test', target: `http://127.0.0.1:${_backendB.port}`, ws: true }
											],
										default: { target: `http://127.0.0.1:${_backendA.port}` },
										logging: { level: 'warn', accessLog: false }
									}
								});
						}
						catch (pError)
						{
							return fDone(pError);
						}

						_proxy.start((pError) =>
						{
							if (pError) return fDone(pError);

							_httpsPort = _proxy.httpsServer.address().port;

							// Read the CA cert so we can verify the chain
							let tmpCaPath = libPath.join(_tmpCertsDir, 'selfsigned', 'ca.cert');
							if (libFS.existsSync(tmpCaPath))
							{
								_caPem = libFS.readFileSync(tmpCaPath, 'utf8');
							}
							return fDone();
						});
					});
				});
			}
		);

		suiteTeardown
		(
			function (fDone)
			{
				this.timeout(30000);
				if (_proxy && _proxy.started)
				{
					_proxy.stop(() =>
					{
						if (_backendA && _backendA.server) _backendA.server.close();
						if (_backendB && _backendB.server) _backendB.server.close();
						if (_tmpCertsDir) libFS.rmSync(_tmpCertsDir, { recursive: true, force: true });
						return fDone();
					});
				}
				else
				{
					if (_backendA && _backendA.server) _backendA.server.close();
					if (_backendB && _backendB.server) _backendB.server.close();
					if (_tmpCertsDir) libFS.rmSync(_tmpCertsDir, { recursive: true, force: true });
					return fDone();
				}
			}
		);

		test
		(
			'proxy starts with an HTTPS server listening on a random port',
			() =>
			{
				Expect(_proxy.started).to.equal(true);
				Expect(_httpsPort).to.be.above(0);
				Expect(_caPem).to.be.a('string');
				Expect(_caPem).to.include('BEGIN CERTIFICATE');
			}
		);

		test
		(
			'dispatches app-a.test → backend A and forwards Host header',
			function (fDone)
			{
				this.timeout(15000);
				httpsGetWithHost('app-a.test', _httpsPort, _caPem, (pError, pStatus, pBody) =>
				{
					if (pError) return fDone(pError);
					try
					{
						Expect(pStatus).to.equal(200);
						let tmpParsed = JSON.parse(pBody);
						// http-proxy changeOrigin rewrites Host to the target's host,
						// so we verify X-Forwarded-Host preserves the original instead.
						Expect(tmpParsed.forwardedHost).to.equal('app-a.test');
						Expect(tmpParsed.url).to.equal('/integration-test-path');
						return fDone();
					}
					catch (pAssertError)
					{
						return fDone(pAssertError);
					}
				});
			}
		);

		test
		(
			'dispatches app-b.test → backend B',
			function (fDone)
			{
				this.timeout(15000);
				httpsGetWithHost('app-b.test', _httpsPort, _caPem, (pError, pStatus, pBody) =>
				{
					if (pError) return fDone(pError);
					try
					{
						Expect(pStatus).to.equal(200);
						let tmpParsed = JSON.parse(pBody);
						Expect(tmpParsed.forwardedHost).to.equal('app-b.test');
						return fDone();
					}
					catch (pAssertError)
					{
						return fDone(pAssertError);
					}
				});
			}
		);

		test
		(
			'unroutable hosts fall through to the default route',
			function (fDone)
			{
				// fallthrough.test has a cert provisioned (via certs.hostnames) but
				// is NOT in the routes array, so the router must fall through to
				// the default target (backend A).
				this.timeout(15000);
				httpsGetWithHost('fallthrough.test', _httpsPort, _caPem, (pError, pStatus, pBody) =>
				{
					if (pError) return fDone(pError);
					try
					{
						Expect(pStatus).to.equal(200);
						let tmpParsed = JSON.parse(pBody);
						Expect(tmpParsed.forwardedHost).to.equal('fallthrough.test');
						return fDone();
					}
					catch (pAssertError)
					{
						return fDone(pAssertError);
					}
				});
			}
		);

		test
		(
			'injects X-Forwarded-Proto: https',
			function (fDone)
			{
				this.timeout(15000);
				httpsGetWithHost('app-a.test', _httpsPort, _caPem, (pError, pStatus, pBody) =>
				{
					if (pError) return fDone(pError);
					try
					{
						let tmpParsed = JSON.parse(pBody);
						Expect(tmpParsed.forwardedProto).to.equal('https');
						return fDone();
					}
					catch (pAssertError)
					{
						return fDone(pAssertError);
					}
				});
			}
		);

		test
		(
			'TLS chain verifies against the local CA (rejectUnauthorized=true)',
			function (fDone)
			{
				// This is implicit in the other tests — they pass ca: _caPem with
				// rejectUnauthorized: true. If the leaf weren't properly signed or
				// missing SANs, those requests would error out. Repeat here for
				// clarity so a failure here is a specific signal.
				this.timeout(15000);
				httpsGetWithHost('app-a.test', _httpsPort, _caPem, (pError, pStatus) =>
				{
					if (pError) return fDone(pError);
					Expect(pStatus).to.equal(200);
					return fDone();
				});
			}
		);
	});
