import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const increment = process.argv[2];
const allowedIncrements = new Set(['major', 'minor', 'patch']);

if (!allowedIncrements.has(increment)) {
	throw new Error('Expected release increment: patch, minor, or major');
}

const releaseArguments = [
	increment,
	'--ci',
	'-n',
	'--git.requireBranch',
	'main',
	'--git.requireCleanWorkingDir',
	'--git.requireUpstream',
	'--git.requireCommits',
	'--git.commit',
	'--git.tag',
	'--git.push',
	'--git.changelog',
	'npx auto-changelog --stdout --unreleased --commit-limit false -u --hide-credit',
	'--github.release=false',
	'--hooks.before:init',
	'npm run lint && npm run build',
	'--hooks.after:bump',
	'npx auto-changelog -p',
	'--npm.publish=false',
];

execFileSync('release-it', releaseArguments, {
	env: {
		...process.env,
		RELEASE_MODE: 'true',
	},
	stdio: 'inherit',
});

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageJson.version;

execFileSync(
	'gh',
	[
		'release',
		'create',
		version,
		'--repo',
		'mtimsit/n8n-nodes-pdf-actions',
		'--title',
		`Release ${version}`,
		'--generate-notes',
	],
	{ stdio: 'inherit' },
);
