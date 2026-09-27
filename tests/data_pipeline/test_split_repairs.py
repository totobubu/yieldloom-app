import unittest
from scripts.data_pipeline.repair_split_types import repair


class SplitRepairsTest(unittest.TestCase):
    def test_only_direction_label_changes(self):
        raw = b'{"tickerInfo":{"events":{"splits":[{"date":"2021-08-02","ratio":"1:8","type":"split"}]}},"backtestData":[{"date":"1962-01-02","close":0.123456789012345678901}]}'
        result, changes = repair(raw)
        self.assertEqual(result, raw.replace(b'"type":"split"', b'"type":"reverse-split"'))
        self.assertEqual(len(changes), 1)
        self.assertEqual(repair(result), (result, []))
