import os
import json
import subprocess
from tqdm import tqdm

ROOT_DIR = os.getcwd()
DATA_DIR = os.path.join(ROOT_DIR, "public", "data")

KEY_ORDER = ["tickerInfo", "dividendTotal", "dividendHistory", "backtestData"]

BACKTEST_DATA_KEY_ORDER = ["dividends", "prices"]


def sort_json_file_keys(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        sorted_data = {}
        for key in KEY_ORDER:
            if key in data:
                if key == "backtestData" and isinstance(data[key], dict):
                    sorted_backtest = {}
                    for sub_key in BACKTEST_DATA_KEY_ORDER:
                        if sub_key in data[key]:
                            sorted_backtest[sub_key] = data[key][sub_key]

                    for sub_key, sub_value in data[key].items():
                        if sub_key not in sorted_backtest:
                            sorted_backtest[sub_key] = sub_value
                    sorted_data[key] = sorted_backtest
                else:
                    sorted_data[key] = data[key]

        for key, value in data.items():
            if key not in sorted_data:
                sorted_data[key] = value

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(sorted_data, f, indent=2, ensure_ascii=False)

        return True

    except (FileNotFoundError, json.JSONDecodeError) as e:
        tqdm.write(
            f"\nWarning: Could not process {os.path.basename(file_path)}. Error: {e}"
        )
        return False
    except Exception as e:
        tqdm.write(
            f"\nAn unexpected error occurred with {os.path.basename(file_path)}: {e}"
        )
        return False


def main():
    print("--- Starting to sort keys in all data JSON files ---")

    json_files = []
    for root, _, files in os.walk(DATA_DIR):
        for file in files:
            if file.endswith(".json"):
                json_files.append(os.path.join(root, file))

    if not json_files:
        print("No JSON files found in public/data directory.")
        return

    for file_path in tqdm(json_files, desc="Sorting JSON files"):
        sort_json_file_keys(file_path)

    print(f"\nSuccessfully processed {len(json_files)} files.")

    print("\n--- Running 'npm run format:data' to finalize formatting ---")
    try:
        subprocess.run(
            "npm run format:data",
            shell=True,
            check=True,
            text=True,
            capture_output=True,
        )
        print("🎉 Formatting complete! All files are sorted and formatted.")
    except subprocess.CalledProcessError as e:
        print(f"❌ Error running 'npm run format:data': {e.stderr}")
    except FileNotFoundError:
        print(
            "❌ Error: 'npm' command not found. Please make sure Node.js is installed and in your PATH."
        )


if __name__ == "__main__":
    main()
