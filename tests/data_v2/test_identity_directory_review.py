import copy
import json
from pathlib import Path
import unittest

from scripts.data_v2.review_identity_directory import review_directories

ROOT = Path(__file__).resolve().parents[2]


def directories(symbol='IREN'):
    return {
        'nasdaqlisted': (f'Symbol|Security Name|Test Issue|ETF\n{symbol}|Issuer ordinary shares|N|N\n'
                         'File Creation Time: 1022202610:01|||\n').encode(),
        'otherlisted': b'ACT Symbol|Security Name|Test Issue|ETF|Exchange\nAMZP|Fund|N|Y|Z\nFile Creation Time: 1022202610:01||||\n',
    }


class IdentityDirectoryReviewTests(unittest.TestCase):
    def setUp(self):
        self.review = json.loads((ROOT / 'data-v2/identity-review.json').read_text())

    def test_similar_candidate_is_not_an_alias_and_exact_match_still_requires_review(self):
        original = copy.deepcopy(self.review)
        result = review_directories(self.review, directories())
        row = next(r for r in result['entries'] if r['symbol'] == 'IREM')
        self.assertEqual(row['exactDirectoryMatches'], [])
        self.assertEqual(row['candidateDirectoryMatches'][0]['symbol'], 'IREN')
        self.assertFalse(row['automaticAlias'])
        exact = review_directories(self.review, directories('IREM'))
        row = next(r for r in exact['entries'] if r['symbol'] == 'IREM')
        self.assertEqual(row['outcome'], 'manual_identity_review_required')
        self.assertFalse(row['listingActivation'])
        self.assertEqual(self.review, original)

    def test_missing_truncated_wrong_or_duplicate_directory_fails_closed(self):
        invalid = [
            {'nasdaqlisted': directories()['nasdaqlisted']},
            {**directories(), 'nasdaqlisted': b'Symbol|Security Name|Test Issue|ETF\nIREN|Issuer|N|N\n'},
            {**directories(), 'nasdaqlisted': directories()['otherlisted']},
            {**directories(), 'nasdaqlisted': directories()['nasdaqlisted'].replace(b'File Creation Time:', b'IREN|Duplicate|N|N\nFile Creation Time:')},
        ]
        for inputs in invalid:
            with self.subTest(inputs=inputs.keys()), self.assertRaises(ValueError):
                review_directories(self.review, inputs)

    def test_new_unresolved_active_identity_cannot_be_silently_deferred(self):
        next(r for r in self.review['entries'] if r['symbol'] == 'IREM')['active'] = True
        with self.assertRaisesRegex(ValueError, 'active'):
            review_directories(self.review, directories())

    def test_recorded_audit_remains_bound_to_review_and_retains_required_evidence(self):
        from scripts.data_platform.pipeline import digest, encode
        audit = json.loads((ROOT / 'data-v2/identity-directory-review.json').read_text())
        self.assertEqual(audit['reviewSha256'], digest(encode(self.review).encode()))
        self.assertEqual(audit['summary'], {'reviewed': 16, 'exactMatchCount': 0, 'candidateOnlyCount': 3, 'automaticChanges': 0})
        unresolved = {r['symbol']: r for r in self.review['entries'] if r['status'] != 'confirmed_isin'}
        self.assertEqual({r['symbol'] for r in audit['entries']}, unresolved.keys())
        for row in audit['entries']:
            self.assertEqual(row['requiredEvidence'], unresolved[row['symbol']]['requiredEvidence'])
            self.assertTrue(row['requiredEvidence'])
            self.assertFalse(row['automaticAlias'])
            self.assertFalse(row['listingActivation'])
