import test from 'node:test';
import assert from 'node:assert/strict';
import {
    reportDiagnostics,
    reportDiagnosticError,
    withReportDiagnostic,
    publicReportFailure,
    normalizeReportDiagnostic,
    reportDiagnosticText,
} from '../lib/report-diagnostics.js';
const id = '12345678-1234-4234-8234-123456789abc';
const secret = 'SYNTHETIC_PRIVATE_SOURCE uid=private token=secret /r2/private';

test('every diagnostic has a stable code/stage and static message; public responses and copy omit source details', () => {
    const stages = new Set();
    for (const [code, info] of Object.entries(reportDiagnostics)) {
        const error = reportDiagnosticError(code);
        error.message = secret;
        error.cause = { private: secret };
        const result = publicReportFailure(error, id);
        assert.deepEqual(result.diagnostic, {
            version: 1,
            code,
            stage: info.stage,
            requestId: id,
        });
        assert.equal(result.error, info.message);
        assert.equal(result.status, info.status);
        const copied = reportDiagnosticText({
            ...result.diagnostic,
            source: secret,
            error: secret,
            expectedHash: secret,
        });
        assert.equal(
            copied,
            `진단 버전: 1\n코드: ${code}\n단계: ${info.stage}\n요청 ID: ${id}`
        );
        assert(!JSON.stringify(result).includes(secret));
        assert(!copied.includes(secret));
        stages.add(info.stage);
    }
    assert(stages.size >= 23);
});
test('untrusted exception properties cannot select a detailed code or expose a message/cause', async () => {
    const error = Object.assign(Error(secret), {
        diagnosticCode: 'INC_RECEIPT_DIGEST',
        status: 200,
        cause: secret,
    });
    assert.equal(
        publicReportFailure(error, id).diagnostic.code,
        'REPORT_UNAVAILABLE'
    );
    assert.equal(
        publicReportFailure(
            { ...error, code: 'INCREMENT_INTEGRITY_FAILED' },
            id
        ).diagnostic.code,
        'INC_UNCLASSIFIED'
    );
    for (const task of [
        () => {
            throw error;
        },
        async () => {
            throw error;
        },
    ]) {
        await assert.rejects(
            async () => withReportDiagnostic('INC_PART_READ', task),
            (e) => {
                const result = publicReportFailure(e, id);
                assert.equal(result.diagnostic.code, 'INC_PART_READ');
                assert(!JSON.stringify(result).includes(secret));
                assert.equal(e.cause, undefined);
                return true;
            }
        );
    }
    const specific = reportDiagnosticError('INC_MEMBER_DIGEST');
    assert.throws(
        () =>
            withReportDiagnostic('INC_PART_READ', () => {
                throw specific;
            }),
        (e) => e === specific
    );
});
test('normalization rejects forged codes/stages and non-opaque IDs; extra fields never survive', () => {
    const valid = {
        version: 1,
        code: 'INC_INDEX_DIGEST',
        stage: 'index',
        requestId: id,
    };
    assert.deepEqual(
        normalizeReportDiagnostic({ ...valid, private: secret }),
        valid
    );
    for (const value of [
        null,
        {},
        { ...valid, version: 2 },
        { ...valid, code: '__proto__' },
        { ...valid, stage: secret },
        { ...valid, requestId: secret },
        { ...valid, requestId: [id] },
        { ...valid, requestId: 'b'.repeat(64) },
    ]) {
        assert.equal(normalizeReportDiagnostic(value), null);
        assert.equal(reportDiagnosticText(value), '');
    }
    assert.equal(
        publicReportFailure(Error(secret), secret).diagnostic,
        undefined
    );
});
test('parallel failures retain their own explicit stage without shared mutable context', async () => {
    const results = await Promise.allSettled(
        ['INC_PART_READ', 'INC_INDEX_READ', 'INC_RECEIPT_READ'].map((code) =>
            withReportDiagnostic(code, async () => {
                await Promise.resolve();
                throw Error(secret);
            })
        )
    );
    assert.deepEqual(
        results.map((r) => publicReportFailure(r.reason, id).diagnostic.code),
        ['INC_PART_READ', 'INC_INDEX_READ', 'INC_RECEIPT_READ']
    );
});
