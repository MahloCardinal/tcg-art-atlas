"""Run Windows OCR without changing PowerShell execution policies.

Optional: python scripts/check_sample.py --only op-ST01-012AA5,op-ST03-009AA
OCR is an additional check, not a proof that an image contains no watermark.
"""
from pathlib import Path
import argparse
import os
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--only', default='')
args = parser.parse_args()
root = Path(__file__).resolve().parent
code = (root / 'check_sample.ps1').read_text(encoding='utf8').replace('$PSScriptRoot', str(root))
if args.only:
    if not all(c.isalnum() or c in '-_.,' for c in args.only):
        raise ValueError('Invalid card IDs')
    code = code.replace("[string]$Only = ''", f"[string]$Only = '{args.only}'")
host = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
raise SystemExit(subprocess.run([str(host), '-NoProfile', '-Command', code]).returncode)
