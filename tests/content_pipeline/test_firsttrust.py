import unittest

from scripts.content_pipeline.models import SourceDocument
from scripts.content_pipeline.providers import FirstTrustAdapter


class FirstTrustProviderParserTest(unittest.TestCase):
    def test_paid_history_preserves_amount_precision_and_skips_expected_rows(self):
        adapter = FirstTrustAdapter()
        events = adapter.parse(SourceDocument(
            provider_slug="firsttrust",
            source_url="https://www.ftportfolios.com/Retail/Etf/EtfDividHistory.aspx?Ticker=XISE",
            source_type="fixture", metadata={"ticker": "XISE"},
            content=b"""<table><thead><tr><th>Month</th><th>Ex-Date</th><th>Record Date</th>
            <th>Payable Date</th><th>Distribution Amount</th><th>Distribution Type</th></tr></thead>
            <tbody><tr><td>September</td><td>9/18/2026</td><td>9/18/2026</td>
            <td>9/21/2026</td><td>$0.151700</td><td>Ordinary Distributions</td></tr>
            <tr><td>October</td><td>--</td><td>--</td><td>--</td><td>--</td><td>Expected</td></tr>
            </tbody></table>""",
        ))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].ticker, "XISE")
        self.assertEqual(events[0].distribution_per_share, "0.151700")
        self.assertEqual(events[0].verification_status, "needs_review")
