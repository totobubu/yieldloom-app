import sys
from pathlib import Path
import os

print("Starting verification script...")

# Add repo root to sys.path
repo_root = Path.cwd()
sys.path.insert(0, str(repo_root))
print(f"Repo root added to sys.path: {repo_root}")

try:
    print("Attempting to import scripts.utils...")
    from scripts.utils import DATA_DIR, PUBLIC_DIR
    print(f"DATA_DIR: {DATA_DIR}")
    
    # Check if DATA_DIR is correct (should be .../public/data)
    expected_data_dir = repo_root / "public" / "data"
    
    # Normalize paths for comparison
    data_dir_resolved = Path(DATA_DIR).resolve()
    expected_resolved = expected_data_dir.resolve()
    
    if str(data_dir_resolved) == str(expected_resolved):
        print("✅ DATA_DIR path is correct.")
    else:
        print(f"❌ DATA_DIR path is incorrect.\nExpected: {expected_resolved}\nGot:      {data_dir_resolved}")
        exit(1)

    # Try importing the failing script
    # We need to simulate the environment where scripts.utils is available
    import scripts.data_pipeline.info_data_pipeline_us
    print("✅ Successfully imported info_data_pipeline_us")
    
except ImportError as e:
    print(f"❌ ImportError: {e}")
    exit(1)
except Exception as e:
    print(f"❌ Unexpected error: {e}")
    exit(1)
