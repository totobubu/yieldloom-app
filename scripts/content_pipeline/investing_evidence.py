"""Strict table-only evidence parser for explicitly mapped Investing securities."""
import re
from datetime import date
from html.parser import HTMLParser
from urllib.parse import urlparse


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []; self.heading = []; self.tables = []; self.table = None
        self.row = None; self.cell = None; self.in_heading = False

    def handle_starttag(self, tag, attrs):
        if tag == "h1": self.in_heading = True
        if tag == "table": self.table = []
        if tag == "tr" and self.table is not None: self.row = []
        if tag in {"td", "th"} and self.row is not None: self.cell = []

    def handle_data(self, data):
        self.text.append(data)
        if self.in_heading: self.heading.append(data)
        if self.cell is not None: self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == "h1": self.in_heading = False
        if tag in {"td", "th"} and self.cell is not None:
            self.row.append(" ".join(self.cell).strip()); self.cell = None
        if tag == "tr" and self.row is not None:
            self.table.append(self.row); self.row = None
        if tag == "table" and self.table is not None:
            self.tables.append(self.table); self.table = None


def korean_date(value):
    match = re.fullmatch(r"\s*(\d{1,2})월\s*(\d{1,2}),\s*(\d{4})\s*", value)
    if not match: raise ValueError("Unsupported Investing date")
    month, day, year = map(int, match.groups())
    return date(year, month, day).isoformat()


def parse_investing(content, ticker, config):
    parsed = urlparse(config["url"])
    if parsed.scheme != "https" or parsed.hostname != "kr.investing.com" or not parsed.path.endswith("-dividends"):
        raise ValueError("Unapproved Investing dividend URL")
    parser = Tables(); parser.feed(content.decode("utf-8"))
    heading, text = " ".join(parser.heading), " ".join(parser.text)
    if not re.search(r"\(" + re.escape(ticker) + r"\)", heading):
        raise ValueError("Investing ticker identity mismatch")
    if config["market_label"] not in text or not re.search(r"통화\s*" + re.escape(config["currency"]) + r"\b", text):
        raise ValueError("Investing market/currency mismatch")
    for table in parser.tables:
        if not table or table[0][:4] != ["배당락일", "배당", "유형", "지불일"]: continue
        observations = []
        for row in table[1:]:
            if len(row) < 4: continue
            try:
                ex_date, payable_date = korean_date(row[0]), korean_date(row[3])
            except ValueError: continue
            observations.append({"ticker": ticker, "ex_date": ex_date, "payable_date": payable_date,
                                 "amount_raw": row[1].replace(",", ""), "currency": config["currency"],
                                 "raw": {"cells": row}})
        if observations: return observations
    raise ValueError("Investing dividend table was absent or blocked")
