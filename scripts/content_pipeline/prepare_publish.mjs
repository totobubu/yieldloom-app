import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const bundlePath = process.argv[2];
if (!bundlePath) {
    throw new Error('Usage: npm run content:publish:prepare -- <bundle-directory>');
}

const root = path.resolve(bundlePath);
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const allowedStatuses = new Set(['official', 'cross_checked']);

if (!allowedStatuses.has(manifest.verificationStatus)) {
    throw new Error(`Publishing package blocked: verification status is ${manifest.verificationStatus ?? 'missing'}.`);
}
if (manifest.publishing?.requiresApproval !== true || !Array.isArray(manifest.publishing.targets)) {
    throw new Error('Publishing package blocked: approval metadata is missing. Regenerate this bundle first.');
}

const plan = [];
for (const target of manifest.publishing.targets) {
    const required = [target.textFile, target.imageFile, manifest.officialUrl];
    if (required.some((value) => typeof value !== 'string' || !value)) {
        throw new Error(`Publishing package blocked: ${target.id} is incomplete.`);
    }
    await fs.access(path.join(root, target.textFile));
    await fs.access(path.join(root, target.imageFile));
    plan.push({ id: target.id, label: target.label, textFile: target.textFile, imageFile: target.imageFile });
}

console.log(JSON.stringify({
    mode: 'dry-run',
    result: 'ready_for_human_approval',
    eventId: manifest.eventId,
    ticker: manifest.ticker,
    officialUrl: manifest.officialUrl,
    targets: plan,
    notice: 'No browser login, external navigation, upload, or post was performed.',
}, null, 2));
