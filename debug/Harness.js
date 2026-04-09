/**
 * Debug harness — spins up a pair of dummy backends and an orator-ssl-proxy
 * in front of them. Useful for manually poking at the proxy during dev.
 *
 * Run with `npm start`.
 */
const libHTTP = require('http');
const libPath = require('path');

const libFable = require('fable');
const libOratorSSLProxy = require('../source/Orator-SSL-Proxy.js');

// Two backends that echo the Host header they received
function startBackend(pPort, pLabel, fCallback)
{
	let tmpServer = libHTTP.createServer((pRequest, pResponse) =>
	{
		pResponse.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
		pResponse.end(`hello from ${pLabel} — host=${pRequest.headers.host} url=${pRequest.url}\n`);
	});
	tmpServer.listen(pPort, '127.0.0.1', () =>
	{
		console.log(`[debug] backend ${pLabel} listening on 127.0.0.1:${pPort}`);
		fCallback(tmpServer);
	});
}

startBackend(19001, 'alpha', () =>
{
	startBackend(19002, 'beta', () =>
	{
		let tmpFable = new libFable(
			{
				Product: 'orator-ssl-proxy-debug',
				ProductVersion: '0.0.0'
			});

		tmpFable.serviceManager.addServiceType('OratorSSLProxy', libOratorSSLProxy);

		let tmpConfigPath = libPath.join(__dirname, 'serve', 'example-config.json');
		let tmpConfig = require(tmpConfigPath);

		let tmpProxy = tmpFable.serviceManager.instantiateServiceProvider('OratorSSLProxy',
			{
				Configuration: tmpConfig
			});

		tmpProxy.start((pError) =>
		{
			if (pError)
			{
				console.error('[debug] failed to start proxy:', pError);
				process.exit(1);
			}
			console.log('[debug] orator-ssl-proxy running');
			console.log('[debug] try: curl -k --resolve alpha.localhost:' + tmpProxy.httpsServer.address().port + ':127.0.0.1 https://alpha.localhost:' + tmpProxy.httpsServer.address().port + '/');
		});
	});
});
