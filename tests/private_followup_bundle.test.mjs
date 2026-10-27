import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { followupCheckpoint } from '../lib/toss-followup-report.js';
test('browser build contains no private checkpoint locators or server R2 credential configuration', async () => {
    const files = (await readdir('dist/assets')).filter((f) =>
        f.endsWith('.js')
    );
    assert(files.length > 0, 'Build before running asset contract tests');
    for (const file of files) {
        const text = await readFile(`dist/assets/${file}`, 'utf8');
        for (const marker of [
            followupCheckpoint.key,
            followupCheckpoint.evidenceKey,
            followupCheckpoint.sha256,
            followupCheckpoint.evidenceSha256,
            'R2_SECRET_ACCESS_KEY',
            'R2_ACCESS_KEY_ID',
            'r2.cloudflarestorage.com',
        ])
            assert(
                !text.includes(marker),
                `Server-only private configuration leaked into ${file}`
            );
    }
});
