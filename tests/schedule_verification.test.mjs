import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { currentScheduleEvent, partitionScheduleHistory } from '../src/services/thumbnail/scheduleVerification.js';

test('the next schedule is the closest confirmed future ex-date regardless of input order', () => {
    const rows = ['2026-10-29', '2026-10-08', '2026-10-22'].map(exDate => ({ exDate, verificationStatus: 'official' }));
    const { confirmed } = partitionScheduleHistory(rows);
    assert.equal(currentScheduleEvent(confirmed, '2026-10-16').exDate, '2026-10-22');
    assert.equal(currentScheduleEvent(confirmed, '2026-10-22').exDate, '2026-10-22');
    assert.equal(currentScheduleEvent(confirmed, '2026-11-01').exDate, '2026-10-29');
    assert.equal(currentScheduleEvent([], '2026-10-16'), null);
    assert.equal(rows[0].exDate, '2026-10-29');
});

test('JEPI collected history stays visible as review data without becoming confirmed', async () => {
    const source = JSON.parse(await fs.readFile('public/content-studio/distribution-ticker-jepi.json', 'utf8'));
    const events = source.history.map(row => ({ exDate: row.ex_date, verificationStatus: row.verification_status, amount: row.distribution_per_share }));
    const result = partitionScheduleHistory(events);
    assert.ok(result.review.length > 0);
    assert.equal(result.review.length, events.filter(row => row.verificationStatus === 'needs_review').length);
    assert.ok(result.review.every(row => row.amount != null));
    assert.ok(result.confirmed.every(row => row.verificationStatus !== 'needs_review'));
});

test('only approved statuses are confirmed and rejected/unknown events are omitted', () => {
    const source = ['official', 'cross_checked', 'needs_review', 'rejected', null].map((verificationStatus, index) => ({ exDate: `2026-10-0${index + 1}`, verificationStatus }));
    const result = partitionScheduleHistory(source);
    assert.deepEqual(result.confirmed.map(row => row.verificationStatus), ['cross_checked', 'official']);
    assert.deepEqual(result.review.map(row => row.verificationStatus), ['needs_review']);
    assert.equal(source[0].verificationStatus, 'official');
});
