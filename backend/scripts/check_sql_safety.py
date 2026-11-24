#!/usr/bin/env python3
"""Guardrail against string-built SQL.

Because there is no ORM, it is easy to slide from a parameterised query
into an f-string, %-formatting, or string concatenation that builds SQL
directly out of a value -- and that is how SQL injection gets in. This
script is a blunt line-by-line grep for those three patterns near an SQL
keyword. It is not a parser and it will occasionally misfire on a query
that is actually safe (for example, a column list built from a Python
constant, not from user input). When that happens, add a comment
containing "sql-safety: allow" to the line and it will be skipped -- do
that sparingly, and say why in the merge request, because every one of
these is worth a second pair of eyes in review. See docs/conventions.md.

Usage: python scripts/check_sql_safety.py [directory ...]
Exits 1 and prints every match if it finds one, 0 otherwise.
"""

import re
import sys
from pathlib import Path

ALLOW_MARKER = "sql-safety: allow"

SQL_KEYWORD = r"(SELECT|INSERT|UPDATE|DELETE|WHERE|VALUES|FROM)"

PATTERNS = {
    "f-string": re.compile(rf"""f["'].*{SQL_KEYWORD}.*\{{""", re.IGNORECASE),
    "%-formatting": re.compile(rf"""["'].*{SQL_KEYWORD}.*["']\s*%\s*[\(\w]""", re.IGNORECASE),
    "+ concatenation": re.compile(rf"""["'].*{SQL_KEYWORD}.*["']\s*\+""", re.IGNORECASE),
}

SKIP_FILES = {Path(__file__).name}
SKIP_DIRS = {"tests", "migrations", "__pycache__", ".venv"}


def find_violations(root: Path) -> list[str]:
    violations = []
    for path in sorted(root.rglob("*.py")):
        if path.name in SKIP_FILES or any(part in SKIP_DIRS for part in path.parts):
            continue
        for lineno, line in enumerate(path.read_text().splitlines(), start=1):
            if ALLOW_MARKER in line:
                continue
            for kind, pattern in PATTERNS.items():
                if pattern.search(line):
                    violations.append(f"{path}:{lineno}: possible {kind} in SQL: {line.strip()}")
    return violations


def main() -> None:
    roots = [Path(p) for p in sys.argv[1:]] or [Path("app"), Path("scripts")]
    violations = [v for root in roots if root.exists() for v in find_violations(root)]
    if violations:
        print("SQL safety check failed:")
        for v in violations:
            print(f"  {v}")
        sys.exit(1)
    print("SQL safety check passed: no string-built SQL found")


if __name__ == "__main__":
    main()
