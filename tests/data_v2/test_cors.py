import copy
import unittest

from scripts.data_v2.configure_cors import ORIGIN, allow_production_origin


class CorsTests(unittest.TestCase):
    def test_addition_preserves_existing_policy_and_input(self):
        rules = [{'AllowedMethods': ['GET', 'HEAD'], 'AllowedOrigins': ['https://totobubu.github.io'],
                  'AllowedHeaders': ['*'], 'ExposeHeaders': ['ETag'], 'MaxAgeSeconds': 3600}]
        original = copy.deepcopy(rules)
        updated = allow_production_origin(rules)
        self.assertEqual(rules, original)
        self.assertEqual(updated[0]['AllowedOrigins'], original[0]['AllowedOrigins'] + [ORIGIN])
        updated[0]['AllowedOrigins'].remove(ORIGIN)
        self.assertEqual(updated, original)

    def test_existing_origin_or_wildcard_is_idempotent(self):
        for origin in (ORIGIN, '*'):
            rules = [{'AllowedMethods': ['GET'], 'AllowedOrigins': [origin]}]
            self.assertEqual(allow_production_origin(rules), rules)

    def test_new_origin_never_inherits_write_methods(self):
        rules = [{'AllowedMethods': ['GET', 'PUT'], 'AllowedOrigins': ['https://uploader.example']}]
        updated = allow_production_origin(rules)
        self.assertEqual(updated[0], rules[0])
        self.assertEqual(updated[1]['AllowedOrigins'], [ORIGIN])
        self.assertEqual(updated[1]['AllowedMethods'], ['GET', 'HEAD'])
