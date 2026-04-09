const libPath = require('path');
const libOS = require('os');
const libChildProcess = require('child_process');

const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

/**
 * `orator-ssl-proxy docker-run` — shell out to docker run with the right
 * volume mounts and port mappings for the prebuilt image.
 */
class OratorSSLProxyCommandDockerRun extends libCommandLineCommand
{
	constructor(pFable, pManifest, pServiceHash)
	{
		super(pFable, pManifest, pServiceHash);

		this.options.CommandKeyword = 'docker-run';
		this.options.Description = 'Run the orator-ssl-proxy Docker image with appropriate mounts.';

		this.options.CommandOptions.push(
			{ Name: '-t, --tag [tag]', Description: 'Image tag to run.', Default: 'orator-ssl-proxy:local' });
		this.options.CommandOptions.push(
			{ Name: '--https-port [port]', Description: 'Host port to bind to container 443.', Default: '443' });
		this.options.CommandOptions.push(
			{ Name: '--http-port [port]', Description: 'Host port to bind to container 80.', Default: '80' });
		this.options.CommandOptions.push(
			{ Name: '--config-path [path]', Description: 'Host path to the config file to mount.', Default: '' });
		this.options.CommandOptions.push(
			{ Name: '--certs-path [path]', Description: 'Host path for persistent cert storage.', Default: '' });
		this.options.CommandOptions.push(
			{ Name: '--name [name]', Description: 'Container name.', Default: 'orator-ssl-proxy' });
		this.options.CommandOptions.push(
			{ Name: '-d, --detach', Description: 'Run detached in background.', Default: false });

		this.addCommand();
	}

	onRunAsync(fCallback)
	{
		let tmpSelf = this;

		let tmpHome = libOS.homedir();
		let tmpConfigPath = this.CommandOptions.configPath || libPath.join(tmpHome, '.orator-ssl.config.json');
		let tmpCertsPath = this.CommandOptions.certsPath || libPath.join(tmpHome, '.orator-ssl', 'certs');
		let tmpTag = this.CommandOptions.tag || 'orator-ssl-proxy:local';
		let tmpName = this.CommandOptions.name || 'orator-ssl-proxy';
		let tmpHTTPSPort = this.CommandOptions.httpsPort || '443';
		let tmpHTTPPort = this.CommandOptions.httpPort || '80';

		let tmpArgs =
			[
				'run',
				'--rm',
				'-p', `${tmpHTTPSPort}:443`,
				'-p', `${tmpHTTPPort}:80`,
				'-v', `${tmpConfigPath}:/config/.orator-ssl.config.json:ro`,
				'-v', `${tmpCertsPath}:/certs`,
				'--name', tmpName
			];
		if (this.CommandOptions.detach)
		{
			tmpArgs.push('-d');
		}
		else
		{
			tmpArgs.push('-it');
		}
		tmpArgs.push(tmpTag);

		tmpSelf.log.info(`running: docker ${tmpArgs.join(' ')}`);

		let tmpProc = libChildProcess.spawn('docker', tmpArgs, { stdio: 'inherit' });
		tmpProc.on('exit', (pCode) =>
		{
			if (pCode !== 0 && !this.CommandOptions.detach)
			{
				tmpSelf.log.error(`docker run exited with code ${pCode}`);
				return fCallback(new Error(`docker run exited with code ${pCode}`));
			}
			return fCallback(null);
		});
		tmpProc.on('error', (pError) =>
		{
			tmpSelf.log.error(`failed to spawn docker: ${pError.message}`);
			return fCallback(pError);
		});
	}
}

module.exports = OratorSSLProxyCommandDockerRun;
