import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from xml.etree import ElementTree as ET
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_history as e


ACCOUNT = "12348888-09"  # Synthetic fixture, never a real account.
FIXTURE = {"trad_dt": "20241218", "sttl_dt": "20241220", "pdno": "DEMO",
           "ovrs_item_name": "테스트종목", "sll_buy_dvsn_cd": "02",
           "ccld_qty": "0.123456789012345678901234", "tr_frcr_amt2": "1.234567890123456789"}


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.last_response_text = ""

    def authenticate(self):
        pass

    def safe(self, message):
        return str(message)

    def get_page(self, account, market, start, end, fk, nk, cont):
        self.calls.append((account, market, start, end, fk, nk, cont))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        headers, body = item
        self.last_response_text = json.dumps(body)
        return headers, body


def response(flag="D", rows=None, key=""):
    return {"tr_cont": flag}, {"rt_cd": "0", "output1": rows if rows is not None else [],
                               "output2": {"demo": "summary"},
                               "ctx_area_fk100": "search" if key else "", "ctx_area_nk100": key}


class PlanTests(unittest.TestCase):
    def assert_before_auth_blocked(self, arguments):
        with patch.object(sys, "argv", ["export_history.py", *arguments]), \
             patch.object(e, "Client") as client, \
             patch.object(e, "read_local_env") as read_env, \
             contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as caught:
                e.main()
            self.assertEqual(caught.exception.code, 2)
        read_env.assert_not_called()
        client.assert_not_called()

    def test_unknown_start_is_not_invented_for_full_history(self):
        end = e.date(2026, 10, 28)
        self.assertEqual(e.window_plan(None, end, False)[-1], (e.date(2026, 10, 1), end))
        with self.assertRaises(e.ExportError):
            e.window_plan(None, end, True)

    def test_full_without_start_stops_before_any_authentication(self):
        self.assert_before_auth_blocked(["--full", "--start-basis", "합성 증빙"])

    def test_full_with_start_but_no_basis_stops_before_credentials_and_auth(self):
        self.assert_before_auth_blocked(["--full", "--start", "2024-12-01"])

    def test_full_empty_or_unknown_basis_stops_before_credentials_and_auth(self):
        for basis in ["", "   \t", "미확인", "unknown", " Unverified ", "none", "null"]:
            with self.subTest(basis=basis):
                self.assert_before_auth_blocked(["--full", "--start", "2024-12-01", "--start-basis", basis])

    def test_full_period_mode_also_requires_basis_before_auth(self):
        self.assert_before_auth_blocked(["--goal", "period", "--full", "--start", "2024-12-01"])

    def test_resume_full_without_basis_stops_before_credentials_and_auth(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            state = {"schema": 2, "start": "2024-12-01", "end": "2024-12-01", "market": "NASD",
                     "full": True, "goal": "full-history", "start_basis": "미확인"}
            (folder / "state.json").write_text(json.dumps(state), encoding="utf-8")
            self.assert_before_auth_blocked(["--resume", str(folder)])

    def test_full_six_year_plan_has_no_gaps_or_overlaps(self):
        start, end = e.parse_date("2020-01-01"), e.parse_date("2025-12-31")
        windows = e.window_plan(start, end, True)
        self.assertEqual(len(windows), 72)
        self.assertEqual(windows[0][0], start)
        self.assertEqual(windows[-1][1], end)
        for previous, following in zip(windows, windows[1:]):
            self.assertEqual(previous[1] + e.timedelta(days=1), following[0])
        self.assertEqual(windows[1][1], e.date(2020, 2, 29))

    def test_probe_is_small_and_clipped(self):
        windows = e.window_plan(e.date(2025, 5, 15), e.date(2025, 5, 19), False)
        self.assertEqual(windows, [(e.date(2025, 5, 15), e.date(2025, 5, 19))])


class PaginationTests(unittest.TestCase):
    def fetch(self, client, callback, **kwargs):
        e.fetch_window(client, ACCOUNT, "NASD", e.date(2024, 12, 1), e.date(2024, 12, 31), callback, **kwargs)

    def test_more_than_ten_pages_and_correct_continuation(self):
        client = FakeClient([response("M", [FIXTURE], str(i)) for i in range(11)] + [response("E", [FIXTURE])])
        captured = []
        self.fetch(client, lambda *args: captured.append(args))
        self.assertEqual(len(captured), 12)
        self.assertEqual(client.calls[0][-3:], ("", "", ""))
        self.assertEqual(client.calls[1][-3:], ("search", "0", "N"))
        self.assertTrue(captured[-1][-1]["terminal"])

    def test_repeated_cursor_preserves_page_but_fails(self):
        client = FakeClient([response("M", [FIXTURE], "same"), response("M", [FIXTURE], "same")])
        captured = []
        with self.assertRaises(e.ExportError):
            self.fetch(client, lambda *args: captured.append(args))
        self.assertEqual(len(captured), 2)
        self.assertIsNone(captured[-1][-1])

    def test_missing_output_is_not_zero_trades(self):
        client = FakeClient([({"tr_cont": "D"}, {"rt_cd": "0"})])
        with self.assertRaises(e.ExportError):
            self.fetch(client, lambda *args: self.fail("Missing output should not be accepted"))

    def test_unknown_flag_preserves_but_fails(self):
        captured = []
        with self.assertRaises(e.ExportError):
            self.fetch(FakeClient([response("Z", [FIXTURE])]), lambda *args: captured.append(args))
        self.assertEqual(len(captured), 1)

    def test_missing_continuation_header_is_not_claimed_complete(self):
        captured = []
        with self.assertRaises(e.ExportError):
            self.fetch(FakeClient([({}, response("D", [FIXTURE])[1])]), lambda *args: captured.append(args))
        self.assertEqual(len(captured), 1)
        self.assertIsNone(captured[0][-1])

    def test_page_guard_does_not_claim_completion(self):
        client = FakeClient([response("M", [FIXTURE], "more")])
        with self.assertRaises(e.ExportError):
            self.fetch(client, lambda *args: None, max_pages=1)

    def test_resume_uses_cursor_and_next_page(self):
        client = FakeClient([response("D", [FIXTURE])])
        captured = []
        self.fetch(client, lambda *args: captured.append(args),
                   checkpoint={"fk": "f", "nk": "n", "next_page": 4, "seen": [["f", "n"]]})
        self.assertEqual(client.calls[0][-3:], ("f", "n", "N"))
        self.assertEqual(captured[0][0], 4)


class ConfigAndTransportTests(unittest.TestCase):
    def test_bom_crlf_and_literal_shell_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env.kis-orders.local"
            path.write_bytes(b'\xef\xbb\xbfKIS_APP_KEY="DEMO_ONLY"\r\nKIS_APP_SECRET=not-real-$(not-executed)\r\nKIS_CANO=12348888\r\nKIS_ACNT_PRDT_CD=09\r\n')
            conf = e.read_local_env(path)
            self.assertEqual(conf["KIS_APP_SECRET"], "not-real-$(not-executed)")
            self.assertEqual(e.configured_accounts(conf), [ACCOUNT])

    def test_product_is_never_guessed(self):
        self.assertEqual(e.configured_accounts({}), [])
        with self.assertRaises(e.ExportError):
            e.configured_accounts({"KIS_CANO": "12348888"})

    def test_txt_suffix_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env.kis-orders.local"
            Path(str(path) + ".txt").write_text("")
            with self.assertRaisesRegex(e.ExportError, ".txt"):
                e.read_local_env(path)

    def test_config_errors_do_not_echo_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config"
            path.write_text("WRONG=DO_NOT_ECHO_FIXTURE", encoding="utf-8")
            with self.assertRaises(e.ExportError) as caught:
                e.read_local_env(path)
            self.assertNotIn("DO_NOT_ECHO_FIXTURE", str(caught.exception))

    def test_api_business_error_stops_and_redacts(self):
        client = e.Client("DEMO_KEY_ONLY", "DEMO_SECRET_ONLY")
        client.token = "DEMO_TOKEN_ONLY"
        client.hidden.append(client.token)
        with patch.object(client, "request", return_value=({}, {"rt_cd": "1", "msg_cd": "EGW00123",
                                                               "msg1": "DEMO_SECRET_ONLY DEMO_TOKEN_ONLY"})):
            with self.assertRaises(e.ExportError) as caught:
                client.get_page(ACCOUNT, "NASD", e.date(2024, 1, 1), e.date(2024, 1, 31), "", "", "")
        self.assertNotIn("DEMO_SECRET_ONLY", str(caught.exception))
        self.assertNotIn("DEMO_TOKEN_ONLY", str(caught.exception))

    def test_mutation_endpoint_is_impossible(self):
        client = e.Client("DEMO_KEY_ONLY", "DEMO_SECRET_ONLY")
        with self.assertRaises(e.ExportError):
            client.request("/uapi/overseas-stock/v1/trading/order", {})

    def test_wire_request_contract_and_raw_decimal_precision_offline(self):
        class FakeResponse:
            headers = {"tr_cont": "D"}
            def __init__(self, raw):
                self.raw = raw
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return self.raw
        raw = b'{"rt_cd":"0","output1":[{"ccld_qty":0.123456789012345678901234}],"output2":{}}'
        client = e.Client("DEMO_KEY_ONLY", "DEMO_SECRET_ONLY")
        with patch.object(client.opener, "open", side_effect=[
                FakeResponse(b'{"access_token":"DEMO_TOKEN_ONLY"}'), FakeResponse(raw)]) as opened, \
             patch.object(e.time, "sleep"):
            client.authenticate()
            headers, body = client.get_page(ACCOUNT, "NASD", e.date(2020, 1, 1), e.date(2020, 1, 31), "f", "n", "N")
        self.assertEqual(body["output1"][0]["ccld_qty"], FIXTURE["ccld_qty"])
        self.assertEqual(client.last_response_text, raw.decode())
        token_request, trade_request = [call.args[0] for call in opened.call_args_list]
        self.assertEqual(token_request.method, "POST")
        self.assertEqual(token_request.full_url, e.BASE + "/oauth2/tokenP")
        self.assertEqual(trade_request.method, "GET")
        self.assertEqual(trade_request.get_header("Tr_id"), "CTOS4001R")
        self.assertEqual(trade_request.get_header("Tr_cont"), "N")
        self.assertIn("ERLM_STRT_DT=20200101", trade_request.full_url)

    def test_http_quota_error_is_not_retried(self):
        client = e.Client("DEMO_KEY_ONLY", "DEMO_SECRET_ONLY")
        error = HTTPError(e.BASE + e.PATH, 429, "fixture", {}, io.BytesIO(b'{"msg1":"quota"}'))
        with patch.object(client.opener, "open", side_effect=error) as opened:
            with self.assertRaisesRegex(e.ExportError, "HTTP 429"):
                client.get_page(ACCOUNT, "NASD", e.date(2020, 1, 1), e.date(2020, 1, 31), "", "", "")
        self.assertEqual(opened.call_count, 1)


class OutputAndReferenceTests(unittest.TestCase):
    def test_xlsx_preserves_precision_text_and_never_formulas(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "demo.xlsx"
            e.xlsx(path, [("테스트", [{"qty": FIXTURE["ccld_qty"], "name": "=1+1", "id": "0000123"}])])
            with ZipFile(path) as book:
                for name in book.namelist():
                    ET.fromstring(book.read(name))
                root = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
                ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
                self.assertEqual(len(root.findall(".//m:f", ns)), 0)
                values = [node.text for node in root.findall(".//m:t", ns)]
                self.assertIn(FIXTURE["ccld_qty"], values)
                self.assertIn("0000123", values)
                self.assertIn("=1+1", values)

    def test_csv_formula_guard_and_negative_numbers(self):
        self.assertEqual(e.csv_value("=1+1"), "'=1+1")
        self.assertEqual(e.csv_value("  @SUM(1)"), "'  @SUM(1)")
        self.assertEqual(e.csv_value("-0.123456789"), "-0.123456789")

    def test_observations_are_not_deduplicated_or_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            query = {"account": e.mask(ACCOUNT), "account_id": e.account_id(ACCOUNT)}
            for i, qty in enumerate(["0.1", "0.1", "0.2"]):
                payload = {"query": query, "page": 1, "response": {"output1": [{**FIXTURE, "ccld_qty": qty}]}}
                e.atomic_json(folder / f"page_{i}.json", payload)
            rows = e.load_observations(folder)
            self.assertEqual(len(rows), 3)
            self.assertEqual(rows[0]["record_fingerprint"], rows[1]["record_fingerprint"])
            self.assertNotEqual(rows[1]["record_fingerprint"], rows[2]["record_fingerprint"])
            self.assertEqual(len({r["observation_id"] for r in rows}), 3)

    def test_quantity_only_is_candidate_not_confirmed_ministock(self):
        with tempfile.TemporaryDirectory() as tmp:
            ref = Path(tmp) / "reference.csv"
            ref.write_text("account,group,date,name,side,qty\n" + e.mask(ACCOUNT) +
                           ",미니스탁,2024-12-18,다른종목,02," + FIXTURE["ccld_qty"] + "\n", encoding="utf-8")
            checks = e.reference_checks([{**FIXTURE, "account": e.mask(ACCOUNT)}],
                [{"account": e.mask(ACCOUNT), "query_from": "2024-12-01", "query_to": "2024-12-31"}],
                ref, e.date(2024, 1, 1), e.date(2024, 12, 31))
            self.assertIn("후보", checks[0]["대조결과"])


class EndToEndOfflineTests(unittest.TestCase):
    def run_main(self, args, client):
        with patch.object(sys, "argv", ["export_history.py", *args]), \
             patch.object(sys.stdin, "isatty", return_value=False), \
             patch.object(e, "Client", return_value=client), \
             patch.dict(os.environ, {}, clear=True), \
             contextlib.redirect_stdout(io.StringIO()):
            return e.main()

    def test_partial_stop_then_resume_to_terminal_without_live_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conf = root / "local.env"
            conf.write_text("KIS_APP_KEY=DEMO_KEY_ONLY\nKIS_APP_SECRET=DEMO_SECRET_ONLY\nKIS_CANO=12348888\nKIS_ACNT_PRDT_CD=09\n")
            first = FakeClient([response("M", [FIXTURE], "cursor1"), e.ExportError("fixture quota error")])
            code = self.run_main(["--env-file", str(conf), "--output", str(root / "results")], first)
            self.assertEqual(code, 1)
            self.assertEqual(len(first.calls), 2)  # no requests for subsequent months on failure
            folder = next((root / "results").iterdir())
            state = json.loads((folder / "state.json").read_text())
            self.assertEqual([w["status"] for w in state["windows"]], ["미완료", "미실행", "미실행"])
            self.assertEqual(state["windows"][0]["checkpoint"]["next_page"], 2)
            second = FakeClient([response("D", [FIXTURE]), response("D"), response("D")])
            code = self.run_main(["--env-file", str(conf), "--resume", str(folder)], second)
            self.assertEqual(code, 0)
            self.assertEqual(second.calls[0][-3:], ("search", "cursor1", "N"))
            rows = json.loads((folder / "records.json").read_text(encoding="utf-8"))
            self.assertEqual(len(rows), 2)
            report = json.loads((folder / "report.json").read_text(encoding="utf-8"))
            self.assertIn("미확정", report["summary"][2]["내용"])
            self.assertEqual(report["coverage"]["goal"], "full-history")
            self.assertIsNone(report["coverage"]["requested_start"])
            self.assertEqual(report["coverage"]["requested_end"], str(e.datetime.now(e.timezone(e.timedelta(hours=9))).date()))
            self.assertEqual(report["coverage"]["earliest_returned_trade_date"], "20241218")
            self.assertFalse(report["coverage"]["account_first_trade_verified"])
            self.assertTrue(report["coverage"]["gaps"])
            for file in folder.iterdir():
                if file.suffix == ".json":
                    text = file.read_text(encoding="utf-8")
                    self.assertNotIn("DEMO_KEY_ONLY", text)
                    self.assertNotIn("DEMO_SECRET_ONLY", text)
                    self.assertNotIn(ACCOUNT, text)

    def test_zero_trades_is_transport_complete_but_coverage_unverified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            e.save_result(root, [], [{"status": "응답종료", "rows": 0}], [], "fixture")
            report = json.loads((root / "report.json").read_text(encoding="utf-8"))
            self.assertIn("미확정", report["summary"][2]["내용"])

    def test_full_valid_basis_authenticates_once_and_preserves_basis(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conf = root / "local.env"
            conf.write_text("KIS_APP_KEY=DEMO_KEY_ONLY\nKIS_APP_SECRET=DEMO_SECRET_ONLY\nKIS_CANO=12348888\nKIS_ACNT_PRDT_CD=09\n")
            client = FakeClient([response("D")])
            with patch.object(client, "authenticate", wraps=client.authenticate) as authenticated:
                code = self.run_main(["--env-file", str(conf), "--output", str(root / "results"),
                    "--full", "--start", "2024-12-01", "--end", "2024-12-01",
                    "--start-basis", "  합성 증빙: 계좌 개설 확인  "], client)
            self.assertEqual(code, 0)
            authenticated.assert_called_once_with()
            self.assertEqual(len(client.calls), 1)
            folder = next((root / "results").iterdir())
            report = json.loads((folder / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["coverage"]["start_basis"], "합성 증빙: 계좌 개설 확인")
            self.assertFalse(report["coverage"]["account_first_trade_verified"])

    def test_restart_window_keeps_old_and_changed_observations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conf = root / "local.env"
            conf.write_text("KIS_APP_KEY=DEMO_KEY_ONLY\nKIS_APP_SECRET=DEMO_SECRET_ONLY\nKIS_CANO=12348888\nKIS_ACNT_PRDT_CD=09\n")
            first = FakeClient([response("M", [FIXTURE], "old"), e.ExportError("fixture failure")])
            self.run_main(["--env-file", str(conf), "--output", str(root / "results")], first)
            folder = next((root / "results").iterdir())
            changed = {**FIXTURE, "ccld_qty": "0.2"}
            second = FakeClient([response("D", [changed]), response("D"), response("D")])
            self.assertEqual(self.run_main(["--env-file", str(conf), "--resume", str(folder), "--restart-window"], second), 0)
            self.assertEqual(second.calls[0][-3:], ("", "", ""))
            rows = json.loads((folder / "records.json").read_text(encoding="utf-8"))
            self.assertEqual({r["ccld_qty"] for r in rows}, {FIXTURE["ccld_qty"], "0.2"})
            self.assertEqual(len(rows), 2)


if __name__ == "__main__":
    unittest.main()
