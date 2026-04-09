const libFS = require('fs');
const libPath = require('path');
const libChildProcess = require('child_process');

const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

/**
 * `orator-ssl-proxy docker-build` — shell out to docker build using the
 * Dockerfile shipped with this module.
 */
class OratorSSLProxyCommandDockerBuild extends libCommandLineCommand
{
	constructor(pFable, pManifest, pServiceHash)
	{
		super(pFable, pManifest, pServiceHash);

		this.options.CommandKeyword = 'docker-build';
		this.options.Description = 'Build the orator-ssl-proxy Docker image.';

		this.options.CommandOptions.push(
			{ Name: '-t, --tag [tag]', Description: 'Image tag to build.', Default: 'orator-ssl-proxy:local' });
		this.options.CommandOptions.push(
			{ Name: '-f, --file [dockerfile]', Description: 'Dockerfile path (relative to module root).', Default: 'Dockerfile' });
		this.options.CommandOptions.push(
			{ Name: '--no-cache', Description: 'Pass --no-cache to docker build.', Default: false });

		this.addCommand();
	}

	onRunAsync(fCallback)
	{
		let tmpSelf = this;

		// The module root is two levels up from this file (source/cli/commands/)
		let tmpModuleRoot = libPath.resolve(__dirname, '..', '..', '..');
		let tmpDockerfile = libPath.join(tmpModuleRoot, this.CommandOptions.file || 'Dockerfile');

		if (!libFS.existsSync(tmpDockerfile))
		{
			tmpSelf.log.error(`Dockerfile not found at ${tmpDockerfile}`);
			return fCallback(new Error('Dockerfile not found'));
		}

		let tmpTag = this.CommandOptions.tag || 'orator-ssl-proxy:local';
		let tmpArgs = ['build', '-t', tmpTag, '-f', tmpDockerfile];
		if (this.CommandOptions.noCache)
		{
			tmpArgs.push('--no-cache');
		}
		tmpArgs.push(tmpModuleRoot);

		tmpSelf.log.info(`running: docker ${tmpArgs.join(' ')}`);

		let tmpProc = libChildProcess.spawn('docker', tmpArgs, { stdio: 'inherit' });
		tmpProc.on('exit', (pCode) =>
		{
			if (pCode !== 0)
			{
				tmpSelf.log.error(`docker build exited with code ${pCode}`);
				return fCallback(new Error(`docker build exited with code ${pCode}`));
			}
			tmpSelf.log.info(`built ${tmpTag}`);
			return fCallback(null);
		});
		tmpProc.on('error', (pError) =>
		{
			tmpSelf.log.error(`failed to spawn docker: ${pError.message}`);
			return fCallback(pError);
		});
	}
}

module.exports = OratorSSLProxyCommandDockerBuild;
