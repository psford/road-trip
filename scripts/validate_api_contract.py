#!/usr/bin/env python3
"""
Validates an external API contract by fetching one record and checking
that expected fields are present. Used by CI to detect API drift.

Usage:
  python scripts/validate_api_contract.py \
    --name PadUsBoundaryImporter \
    --url "https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US/MapServer/0/query?where=Des_Tp=%27SP%27&outFields=OBJECTID,Unit_Nm,State_Nm,Des_Tp,GIS_Acres&resultRecordCount=1&f=json" \
    --required-fields "features" \
    --required-feature-fields "OBJECTID,Unit_Nm,State_Nm,Des_Tp,GIS_Acres" \
    --feature-array-key "features" \
    --feature-attr-key "attributes"
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={
        "User-Agent": "RoadTripMap-ContractValidator/1.0",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--required-fields", default="",
                        help="Comma-separated top-level required keys")
    parser.add_argument("--required-feature-fields", default="",
                        help="Comma-separated required keys in each feature")
    parser.add_argument("--feature-array-key", default="features",
                        help="Key containing the feature array")
    parser.add_argument("--feature-attr-key", default=None,
                        help="Key within each feature containing attributes (e.g. 'attributes' for ArcGIS)")
    args = parser.parse_args()

    required_top = [f.strip() for f in args.required_fields.split(",") if f.strip()]
    required_feat = [f.strip() for f in args.required_feature_fields.split(",") if f.strip()]

    print(f"[{args.name}] Fetching: {args.url[:80]}...")

    try:
        raw = fetch(args.url)
    except urllib.error.HTTPError as e:
        print(f"  FAIL: HTTP {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"  FAIL: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"  FAIL: Not valid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    failures = []

    # Check top-level fields
    for f in required_top:
        if f not in payload:
            failures.append(f"Missing top-level field: '{f}'")

    # Check feature fields
    if required_feat and args.feature_array_key:
        arr = payload.get(args.feature_array_key)
        if not isinstance(arr, list):
            failures.append(f"'{args.feature_array_key}' is not an array")
        elif len(arr) == 0:
            print(f"  WARN: '{args.feature_array_key}' is empty — cannot validate feature fields")
        else:
            first = arr[0]
            if args.feature_attr_key and args.feature_attr_key in first:
                first = first[args.feature_attr_key]
            for f in required_feat:
                if f not in first:
                    failures.append(f"Missing feature field: '{f}' (available: {sorted(first.keys())})")

    if failures:
        print(f"  FAIL: Contract validation failed for {args.name}:", file=sys.stderr)
        for f in failures:
            print(f"    - {f}", file=sys.stderr)
        sys.exit(1)

    print(f"  OK: All required fields present")


if __name__ == "__main__":
    main()
