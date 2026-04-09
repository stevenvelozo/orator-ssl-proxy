const libCLIProgram = require('pict-service-commandlineutility');

let _OratorSSLProxyCLIProgram = new libCLIProgram(
	{
		Product: 'orator-ssl-proxy',
		Version: require('../../package.json').version,

		Command: 'orator-ssl-proxy',
		Description: 'SSL-terminating reverse proxy with host-based routing and local CA / Let\'s Encrypt support.',

		ProgramConfigurationFileName: '.orator-ssl.config.json',
		AutoGatherProgramConfiguration: true,
		AutoAddConfigurationExplanationCommand: true
	},
	[
		require('./commands/OratorSSLProxy-Command-Serve.js'),
		require('./commands/OratorSSLProxy-Command-DockerBuild.js'),
		require('./commands/OratorSSLProxy-Command-DockerRun.js'),
		require('./commands/OratorSSLProxy-Command-CertShow.js'),
		require('./commands/OratorSSLProxy-Command-CertRenew.js'),
		require('./commands/OratorSSLProxy-Command-CertInstallRootCA.js'),
		require('./commands/OratorSSLProxy-Command-CertUninstallRootCA.js'),
		require('./commands/OratorSSLProxy-Command-CertExportRootCA.js')
	]);

module.exports = _OratorSSLProxyCLIProgram;
