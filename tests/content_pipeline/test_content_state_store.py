import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from botocore.exceptions import ClientError

from scripts.content_pipeline import content_state_store


class ContentStateStoreTest(unittest.TestCase):
    def test_missing_state_is_reported_when_restore_is_required(self):
        missing = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}},
            "GetObject",
        )
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict("os.environ", {"R2_BUCKET_NAME": "content-studio"}), \
             patch.object(content_state_store, "_client") as client:
            client.return_value.download_file.side_effect = missing
            with self.assertRaisesRegex(FileNotFoundError, "latest.tar.gz"):
                content_state_store.restore(
                    Path(directory), "content-studio/state/latest.tar.gz", require_existing=True
                )

    def test_missing_state_can_still_be_used_for_explicit_bootstrap(self):
        missing = ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "Not Found"}},
            "GetObject",
        )
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict("os.environ", {"R2_BUCKET_NAME": "content-studio"}), \
             patch.object(content_state_store, "_client") as client:
            client.return_value.download_file.side_effect = missing
            self.assertFalse(
                content_state_store.restore(
                    Path(directory), "content-studio/state/latest.tar.gz"
                )
            )


if __name__ == "__main__":
    unittest.main()
