"""Vercel imports entrypoints from the project root, without api on sys.path."""
import subprocess
import sys
import unittest
from pathlib import Path


class ServerlessImportsTest(unittest.TestCase):
    def test_entrypoints_load_from_project_root(self):
        root = Path(__file__).resolve().parents[1]
        code = """
import importlib.util
for filename in ['portfolio-import', 'toss-connection', 'analytics']:
    spec = importlib.util.spec_from_file_location('api.' + filename, 'api/' + filename + '.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.app
"""
        subprocess.run([sys.executable, '-c', code], cwd=root, check=True, capture_output=True, text=True)
