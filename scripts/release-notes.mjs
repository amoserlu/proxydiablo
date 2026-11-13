#!/usr/bin/env node
import fs from 'node:fs';

// The tag, package files, and human-maintained notes must describe one version.
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const tag = process.argv[2] ?? `v${pkg.version}`;
if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${pkg.version}`
    || lock.version !== pkg.version || lock.packages[''].version !== pkg.version) {
  throw new Error('Release tag and package versions must match (vMAJOR.MINOR.PATCH).');
}
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const sections = changelog.split(/^## /m);
const section = sections.find(value => value.startsWith(`[${pkg.version}] - `));
if (!section) throw new Error(`Missing CHANGELOG.md entry for ${tag}.`);
const body = section.slice(section.indexOf('\n') + 1).replace(/^\[[^\]]+\]: .*$/gm, '').trim();
if (!body || !/^### /m.test(body)) throw new Error('Release notes must contain categorized changes.');
console.log(body);
