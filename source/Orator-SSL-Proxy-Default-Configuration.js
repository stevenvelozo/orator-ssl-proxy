/**
 * Default configuration for orator-ssl-proxy.
 *
 * Values here are deep-merged under any user-supplied configuration in
 * SSL-Proxy-Configuration-Loader.js. `null` ports mean "use the hashed
 * default derived from the package name."
 */
const _DefaultConfiguration =
{
	https:
	{
		port: null,
		host: '0.0.0.0',
		minVersion: 'TLSv1.2'
	},

	http:
	{
		port: null,
		host: '0.0.0.0',
		redirectToHttps: true
	},

	certs:
	{
		strategy: 'selfsigned',
		storagePath: '~/.orator-ssl/certs',
		hostnames: [],

		letsencrypt:
		{
			email: null,
			staging: true,
			directoryUrl: null,
			renewBeforeDays: 30,
			renewCheckIntervalHours: 12,
			bootstrapWithSelfSigned: true
		},

		selfsigned:
		{
			mode: 'localCA',
			caCommonName: 'Retold Orator SSL Proxy Local CA',
			caOrganization: 'Retold',
			caValidityYears: 10,
			leafValidityDays: 365,
			keySize: 2048
		},

		file:
		{
			default: { key: null, cert: null, ca: null },
			hosts: []
		}
	},

	routes: [],

	default:
	{
		target: null
	},

	logging:
	{
		level: 'info',
		accessLog: true
	}
};

module.exports = _DefaultConfiguration;
