"""A single writer across CLI collection, checkpointing and scheduled runs."""
from contextlib import contextmanager
from pathlib import Path
import os


@contextmanager
def writer_lock(root):
    import fcntl
    root = Path(root).resolve()
    root.parent.mkdir(parents=True, exist_ok=True)
    path = root.parent / ('.' + root.name + '.lock')
    with path.open('a') as handle:
        os.chmod(path, 0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Another data platform writer is running') from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
