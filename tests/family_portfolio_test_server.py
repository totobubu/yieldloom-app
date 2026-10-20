"""LOCAL TEST ONLY. Never deploy: Firebase identity and DB replaced by test doubles."""
import sys
import os
from contextlib import ExitStack
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from unittest.mock import patch
from test_family_portfolio import Store, api


def synthetic_pdf(content, password, *, metadata=None):
    """Opt-in deterministic PDF fixture for local browser tests, never personal data."""
    if content != b'%PDF-asset-management-fixture':
        raise api.PortfolioError('토스 PDF를 해석하지 못했습니다.')
    if password != 'fixture':
        raise api.PortfolioError('PDF 비밀번호를 확인하세요.')
    if metadata is not None:
        metadata.update({'customerName': '배우자', 'maskedNumber': '****5678'})
    return [{'date': '2026-10-15', 'symbol': 'AAPL', 'quantity': 1, 'amount': 100,
             'currency': 'USD', 'type': 'buy', 'externalId': 'asset-pdf-trade'}]

if __name__ == '__main__':
    with ExitStack() as stack, patch.object(api, 'database', return_value=Store()), \
         patch.object(api.auth, 'verify_id_token', side_effect=lambda token, **kw: {'uid': token}), \
         patch.object(api.firestore, 'transactional', side_effect=lambda f: f):
        if os.environ.get('FAMILY_TEST_SYNTHETIC_PDF') == '1':
            stack.enter_context(patch.object(api, 'pdf_rows', side_effect=synthetic_pdf))
        api.app.run(host='127.0.0.1', port=5011, debug=False)
