"""LOCAL TEST ONLY. Never deploy: Firebase identity and DB replaced by test doubles."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from unittest.mock import patch
from test_family_portfolio import Store, api

if __name__ == '__main__':
    with patch.object(api, 'database', return_value=Store()), \
         patch.object(api.auth, 'verify_id_token', side_effect=lambda token, **kw: {'uid': token}), \
         patch.object(api.firestore, 'transactional', side_effect=lambda f: f):
        api.app.run(host='127.0.0.1', port=5011, debug=False)
