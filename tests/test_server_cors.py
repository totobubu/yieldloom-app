"""Cross-origin contract for the canonical Pages frontend and configured apps."""
import unittest
from unittest.mock import patch

from flask import Flask
from api.server_cors import configure_cors


class ServerCorsTests(unittest.TestCase):
    def test_allowed_origins_and_preflights(self):
        app = Flask(__name__)
        configure_cors(app)

        @app.route('/api/test', methods=['GET', 'OPTIONS'])
        def endpoint():
            return {'ok': True}

        with patch.dict('os.environ', {'PUBLIC_APP_ORIGINS': 'https://configured.example'}):
            client = app.test_client()
            for origin, allowed in [
                ('https://totobubu.github.io', True),
                ('https://configured.example', True),
                ('https://unrelated.example', False),
                ('https://totobubu.github.io.unrelated.example', False),
            ]:
                for method in ['GET', 'OPTIONS']:
                    with self.subTest(origin=origin, method=method):
                        result = client.open('/api/test', method=method, headers={'Origin': origin})
                        self.assertEqual(result.status_code, 200)
                        self.assertEqual(result.headers.get('Access-Control-Allow-Origin'), origin if allowed else None)
                        if allowed:
                            self.assertEqual(result.headers.get('Vary'), 'Origin')
                            self.assertEqual(result.headers.get('Access-Control-Expose-Headers'), 'Retry-After')
                        else:
                            self.assertIsNone(result.headers.get('Access-Control-Expose-Headers'))


if __name__ == '__main__':
    unittest.main()
