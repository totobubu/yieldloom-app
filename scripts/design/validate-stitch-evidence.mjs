// Evidence integrity is separate from visual acceptance. --require-parity is a failing release gate until every visual/state difference is resolved.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const repo = process.cwd();
const evidence =
    process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const mapping = await read(
    path.join(repo, 'docs/design/stitch-v2/mapping.json')
);
const captures = (
    await read(path.join(evidence, 'content-implementation/results.json'))
).results;
const comparisons = (
    await read(path.join(evidence, 'content-comparisons/results.json'))
).rows;
const shells = (
    await read(path.join(evidence, 'shell-comparison/results.json'))
).results;
const failures = [];
const references = (
    await read(path.join(evidence, 'rendered-originals/results.json'))
).rows;
const sourceRecords = mapping.screens.filter(
    (row) => row.hasHtml && row.hasPng
);
for (const row of sourceRecords) {
    for (const [file, expected] of [
        [
            path.join(repo, 'docs/design/stitch-v2', row.originalHtml),
            row.htmlSha256,
        ],
        [
            path.join(
                evidence,
                'originals',
                row.projectId,
                row.screenId + '.png'
            ),
            row.pngSha256,
        ],
    ]) {
        try {
            const actual = crypto
                .createHash('sha256')
                .update(await fs.readFile(file))
                .digest('hex');
            if (actual !== expected)
                failures.push({
                    screenId: row.screenId,
                    criterion: 'original-sha256',
                    file,
                });
        } catch {
            failures.push({
                screenId: row.screenId,
                criterion: 'original-file-missing',
                file,
            });
        }
    }
}
const kinds = [...new Set(captures.map((row) => row.name))];
if (
    kinds.length !== 14 ||
    captures.length !== 42 ||
    comparisons.length !== 42 ||
    shells.length !== 12
)
    failures.push({
        criterion: 'required-counts',
        kinds: kinds.length,
        captures: captures.length,
        comparisons: comparisons.length,
        shells: shells.length,
    });
// The review decision is evidence supplied by the recorded human/source audit,
// not a pixel algorithm. Never hard-code every screen to fail or invent a score.
const visualReview = await read(path.join(evidence, 'screen-status.json'));
const reviewFor = (name) =>
    visualReview.screens.find((row) => row.name === name);
const screens = kinds.map((name) => {
    const rows = captures.filter((row) => row.name === name);
    const source = mapping.screens.find(
        (row) => row.screenId === rows[0].screenId
    );
    for (const width of [1280, 768, 390]) {
        const matches = rows.filter((row) => row.width === width);
        const compared = comparisons.filter(
            (row) => row.name === name && row.viewportWidth === width
        );
        if (matches.length !== 1 || compared.length !== 1) {
            failures.push({ name, width, criterion: 'unique-viewport-pair' });
            continue;
        }
        const row = matches[0],
            pair = compared[0];
        const refs = references.filter(
            (r) => r.screenId === row.screenId && r.width === width
        );
        if (
            refs.length !== 1 ||
            refs[0].status !== 'captured' ||
            refs[0].fontsReady !== 'loaded'
        )
            failures.push({
                name,
                width,
                criterion: 'reference-render-health',
                references: refs,
            });
        if (
            row.status !== 'captured' ||
            row.overflow ||
            row.errors.length ||
            row.assetFailures?.length ||
            row.typography?.fontsReady !== 'loaded'
        )
            failures.push({ name, width, criterion: 'capture-health', row });
        const hankenViews = new Set([
            'stock-dividends',
            'stock-share',
            'compare-underlying',
            'compare-similar',
            'compare-theme',
            'portfolio-summary',
            'portfolio-holdings',
            'asset-management',
            'account-registration',
        ]);
        if (
            row.typography?.fontEvidenceVersion !== 2 ||
            row.typography?.shellFontLoaded !== true ||
            ([
                'portfolio-summary',
                'portfolio-holdings',
                'asset-management',
            ].includes(name) &&
                row.typography?.monoLoaded !== true) ||
            (hankenViews.has(name) && row.typography?.hankenLoaded !== true)
        )
            failures.push({
                name,
                width,
                criterion: 'registered-font-load-evidence',
                typography: row.typography,
            });

        if (
            pair.sourceScreenId !== row.screenId ||
            pair.implementationSize[0] !== width * 2 ||
            pair.originalSize[0] !== width * 2
        )
            failures.push({
                name,
                width,
                criterion: 'same-viewport-unscaled-content',
                pair,
            });
    }
    return {
        name,
        screenId: source?.screenId,
        path: rows[0].path,
        criteria: {
            sourceIdentity: source ? 'pass' : 'fail',
            viewportPairs: rows.length === 3 ? 'pass' : 'fail',
            pixelParity: 'not-scored',
            visualReview: reviewFor(name)?.visualAcceptance || 'unreviewed',
            allSourceStates: reviewFor(name)?.allSourceStates || 'unverified',
            liveAccountVerification:
                reviewFor(name)?.liveAccountVerification || 'not-run',
        },
        sourceStateLabelCount: source?.observedStateLabels?.length || 0,
        sourceStatesReference: 'mapping.json#' + source?.screenId,
        remainingDifferences: 'CURRENT_MATRIX.md#' + name,
    };
});
for (const row of shells)
    if (
        row.errors.length ||
        row.assetFailures.length ||
        row.geometry.overflow ||
        row.geometry.contentReady !== true ||
        (row.geometry.drawer &&
            (row.geometry.drawer.left < -1 ||
                row.geometry.drawer.right > row.width + 1)) ||
        (row.geometry.submenu &&
            (row.geometry.submenu.left < -1 ||
                row.geometry.submenu.right > row.width + 1)) ||
        (row.name === 'pc-closed' &&
            (row.geometry.railWidth !== 56 ||
                row.geometry.mainWidth !== 1008)) ||
        (row.name === 'pc-submenu' &&
            (row.geometry.mainWidth !== 984 ||
                row.geometry.headerContainerWidth !== 1280)) ||
        row.geometry.header !== (row.width < 768 ? 56 : 64)
    )
        failures.push({ name: row.name, criterion: 'shell-health', row });
const knownStateSuites = [];
for (const [directory, expected, meaning] of [
    [
        'registration-states',
        30,
        '10 known registration states x3 widths; synthetic PDF inspection only',
    ],
    ['share-states', 18, '6 preview/ZIP/disabled/empty states x3 widths'],
    [
        'summary-scope-states',
        15,
        '5 account/currency/missing-price scope states x3 widths',
    ],
    [
        'holdings-view-states',
        6,
        'holder/symbol views x3 widths, full viewport DPR2; synthetic data',
    ],
    [
        'dividend-navigation-states',
        9,
        'two years and restored monthly detail x3 widths; fixed synthetic history',
    ],
]) {
    try {
        const files = (await fs.readdir(path.join(evidence, directory))).filter(
            (file) => file.endsWith('.png')
        );
        const status = files.length === expected ? 'pass' : 'fail';
        knownStateSuites.push({
            directory,
            expected,
            captured: files.length,
            status,
            meaning,
        });
        for (const file of files) {
            const width = Number(file.match(/-(1280|768|390)\.png$/)?.[1]);
            const png = await fs.readFile(path.join(evidence, directory, file));
            if (!width || png.readUInt32BE(16) !== width * 2)
                failures.push({
                    criterion: 'known-state-DPR2-width',
                    directory,
                    file,
                });
        }
        if (status === 'fail')
            failures.push({
                criterion: 'known-state-capture-count',
                directory,
                expected,
                captured: files.length,
            });
    } catch {
        knownStateSuites.push({ directory, status: 'not-run', meaning });
    }
}
// Priority panel states are component crops, not resized full-viewport PNGs.
for (const [directory, expected, meaning] of [
    [
        'priority-states',
        39,
        '13 known priority states x3 widths; component crops',
    ],
    [
        'schedule-states',
        9,
        'confirmed/forecast/unconfirmed x3 widths; component crops; synthetic event currency and zero',
    ],
]) {
    try {
        const metadata = await read(
            path.join(evidence, directory, 'results.json')
        );
        const entries = metadata.captured || [];
        const files = (await fs.readdir(path.join(evidence, directory))).filter(
            (file) => file.endsWith('.png')
        );
        const keys = new Set(entries.map((row) => `${row.name}:${row.width}`));
        if (
            entries.length !== expected ||
            files.length !== expected ||
            keys.size !== expected
        )
            failures.push({
                directory,
                criterion: 'component-state-count',
                entries: entries.length,
                files: files.length,
                unique: keys.size,
            });
        for (const row of entries) {
            const png = await fs.readFile(
                path.join(evidence, directory, `${row.name}-${row.width}.png`)
            );
            const width = png.readUInt32BE(16),
                height = png.readUInt32BE(20);
            if (
                row.dpr !== 2 ||
                width <= 0 ||
                width > row.width * 2 ||
                height <= 0
            )
                failures.push({
                    directory,
                    criterion: 'component-crop-geometry',
                    name: row.name,
                    viewport: row.width,
                    pngWidth: width,
                    pngHeight: height,
                });
        }
        knownStateSuites.push({
            directory,
            expected,
            captured: entries.length,
            status:
                entries.length === expected &&
                files.length === expected &&
                keys.size === expected
                    ? 'pass'
                    : 'fail',
            meaning,
        });
    } catch (error) {
        failures.push({
            directory,
            criterion: 'component-state-evidence',
            error: error.message,
        });
        knownStateSuites.push({
            directory,
            status: 'not-run',
            meaning,
        });
    }
}
const sourceVariantReferences = [];
try {
    const directory = 'holdings-view-references';
    const metadata = await read(path.join(evidence, directory, 'results.json'));
    const rows = metadata.rows || [];
    if (
        rows.length !== 6 ||
        new Set(rows.map((r) => `${r.mode}:${r.width}`)).size !== 6
    )
        throw new Error('Expected two original modes at all three widths');
    for (const row of rows) {
        const png = await fs.readFile(
            path.join(evidence, directory, `${row.mode}-${row.width}.png`)
        );
        if (
            row.errors.length ||
            row.failures.length ||
            row.dpr !== 2 ||
            png.readUInt32BE(16) !== row.width * 2
        )
            throw new Error(`Invalid original mode ${row.mode}/${row.width}`);
    }
    sourceVariantReferences.push({
        directory,
        expected: 6,
        captured: rows.length,
        status: 'pass',
    });
} catch (error) {
    failures.push({ criterion: 'source-mode-reference', error: error.message });
}
for (const [directory, expected, key] of [
    ['dividend-year-references', 6, 'rows'],
    ['dividend-navigation-states', 9, 'captures'],
]) {
    try {
        const metadata = await read(
            path.join(evidence, directory, 'results.json')
        );
        const rows = metadata[key] || [];
        if (
            rows.length !== expected ||
            new Set(rows.map((r) => `${r.name}:${r.width}`)).size !== expected
        )
            throw new Error(
                `Expected ${expected} distinct year/navigation states`
            );
        for (const row of rows) {
            const png = await fs.readFile(
                path.join(evidence, directory, `${row.name}-${row.width}.png`)
            );
            if (
                row.errors?.length ||
                row.failures?.length ||
                row.dpr !== 2 ||
                png.readUInt32BE(16) !== row.width * 2
            )
                throw new Error(
                    `Invalid ${directory}/${row.name}/${row.width}`
                );
        }
        if (directory === 'dividend-year-references')
            sourceVariantReferences.push({
                directory,
                expected,
                captured: rows.length,
                status: 'pass',
            });
    } catch (error) {
        failures.push({
            directory,
            criterion: 'year-navigation-evidence',
            error: error.message,
        });
    }
}
const shellReviews = shells.map((row) => ({
    name: row.name,
    screenId: row.screenId,
    pixelParity: 'not-scored',
    visualReview:
        visualReview.shellStates?.find((item) => item.name === row.name)
            ?.visualAcceptance || 'unreviewed',
    note: row.visualStatus,
}));
const reviewDecisions = [
    ...screens.map((row) => row.criteria.visualReview),
    ...shellReviews.map((row) => row.visualReview),
];
const reviewedVisualAcceptance = reviewDecisions.includes('fail')
    ? 'fail'
    : reviewDecisions.every((value) => value === 'pass')
      ? 'pass'
      : 'unreviewed';
// Recorded attestations are independent of integrity and diagnostic pixel ratios.
// Missing source-state or live verification remains unresolved, never auto-passed.
const releaseReady =
    failures.length === 0 &&
    reviewedVisualAcceptance === 'pass' &&
    screens.every(
        (row) =>
            row.criteria.allSourceStates === 'pass' &&
            row.criteria.liveAccountVerification === 'pass'
    );
const report = {
    methodology: {
        pixelComparison: 'diagnostic only; not an automated acceptance test',
        visualReviewSource:
            'screen-status.json; recorded review, not inferred from pixels',
        reviewPhase: visualReview.phase,
        scope: 'integrity plus recorded decision; source state/live gates require separate evidence',
    },
    sourceVariantReferences,
    knownStateSuites,
    integrity: failures.length ? 'fail' : 'pass',
    visualAcceptance: reviewedVisualAcceptance,
    releaseReady,
    criteria: {
        sourceHashes: 'all selected originals unchanged',
        geometry:
            '14 content kinds x 3 widths at DPR2; same viewport, no resizing; 12 shell states',
        visualAcceptance:
            'all required elements, spacing, typography, states, data semantics and exports verified; zero unresolved visual deviations',
        stateCoverage:
            'single fixture screenshots do not prove every loading/empty/error/disabled/review state',
        financialData:
            'prototype numbers must never replace actual calculations; mismatches remain explicit',
    },
    originalRecordsChecked: sourceRecords.length,
    screens,
    shellStates: shellReviews,
    failures,
    unresolvedAcceptance: [
        ...(reviewedVisualAcceptance === 'pass'
            ? []
            : [
                  'Recorded content/shell visual review has unresolved or unreviewed decisions',
              ]),
        'All source-state transitions have not been exhaustively verified',
        'Prototype example values differ from actual fixtures; approved latest-event and TTM meanings remain separate',
        '29 planned kinds have no confirmed source in the content project',
        'Real user account authentication/data not exercised; remote CI not run',
    ],
};
await fs.writeFile(
    path.join(evidence, 'verification.json'),
    JSON.stringify(report, null, 2) + '\n'
);
console.log(
    JSON.stringify({
        integrity: report.integrity,
        visualAcceptance: report.visualAcceptance,
        originalRecordsChecked: sourceRecords.length,
        contentKinds: screens.length,
        shellStates: shells.length,
        integrityFailures: failures.length,
    })
);
if (
    failures.length ||
    (process.argv.includes('--require-parity') && !report.releaseReady)
)
    process.exitCode = 1;
