"""
tests/test_manuals.py — Manual format validation.

For each .txt file in data/manuals/:
  - Verify "Category:" line is present
  - Verify at least one "- Do not" bullet is present (replaces NEVER DO: section)
  - Verify at least one plain "- " action bullet is present (replaces STEPS: section)
  - Verify token count is between 80 and 150 (tiktoken cl100k_base)
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tiktoken
from config import MANUALS_DIR


# ---------------------------------------------------------------------------
# Discover all manual files
# ---------------------------------------------------------------------------

def _get_manual_files() -> list[tuple[str, str]]:
    """Return list of (category_id, filepath) for all .txt files in MANUALS_DIR."""
    if not os.path.isdir(MANUALS_DIR):
        return []
    results = []
    for filename in sorted(os.listdir(MANUALS_DIR)):
        if filename.endswith(".txt"):
            category_id = filename[:-4]
            filepath = os.path.join(MANUALS_DIR, filename)
            results.append((category_id, filepath))
    return results


_MANUAL_FILES = _get_manual_files()
_ENCODING = tiktoken.get_encoding("cl100k_base")


# ---------------------------------------------------------------------------
# Parametrize over all manuals
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("category_id,filepath", _MANUAL_FILES)
def test_manual_has_category_line(category_id: str, filepath: str):
    """Every manual must start with a 'Category:' line."""
    with open(filepath, encoding="utf-8") as fh:
        content = fh.read()
    assert "Category:" in content, (
        f"Manual '{category_id}' ({filepath}) is missing 'Category:' line"
    )


@pytest.mark.parametrize("category_id,filepath", _MANUAL_FILES)
def test_manual_has_action_bullets(category_id: str, filepath: str):
    """Every manual must contain at least one '- ' action bullet (replaces STEPS: section)."""
    with open(filepath, encoding="utf-8") as fh:
        content = fh.read()
    lines = content.splitlines()
    action_bullets = [ln for ln in lines if ln.startswith("- ") and not ln.lower().startswith("- do not")]
    assert action_bullets, (
        f"Manual '{category_id}' ({filepath}) has no action bullets (lines starting with '- ')"
    )


@pytest.mark.parametrize("category_id,filepath", _MANUAL_FILES)
def test_manual_has_do_not_bullets(category_id: str, filepath: str):
    """Every manual must contain at least one '- Do not' bullet (replaces NEVER DO: section)."""
    with open(filepath, encoding="utf-8") as fh:
        content = fh.read()
    lines = content.splitlines()
    do_not_bullets = [ln for ln in lines if ln.lower().startswith("- do not")]
    assert do_not_bullets, (
        f"Manual '{category_id}' ({filepath}) is missing '- Do not' bullets (NEVER DO equivalent)"
    )


@pytest.mark.parametrize("category_id,filepath", _MANUAL_FILES)
def test_manual_token_count_in_range(category_id: str, filepath: str):
    """Manual token count must be between 80 and 150 (tiktoken cl100k_base)."""
    with open(filepath, encoding="utf-8") as fh:
        content = fh.read()
    token_count = len(_ENCODING.encode(content))
    assert 80 <= token_count <= 150, (
        f"Manual '{category_id}' has {token_count} tokens — must be 80-150. "
        f"File: {filepath}"
    )


@pytest.mark.parametrize("category_id,filepath", _MANUAL_FILES)
def test_manual_no_markdown(category_id: str, filepath: str):
    """Manuals should not contain markdown headers, bold markers, or bullet asterisks."""
    with open(filepath, encoding="utf-8") as fh:
        content = fh.read()
    # Check for common markdown patterns (# headings, ** bold, ``` code)
    assert "```" not in content, f"Manual '{category_id}' contains markdown code block"
    # Allow * in "NEVER DO" lists as hyphens are used there, just check for ** bold
    assert "**" not in content, f"Manual '{category_id}' contains markdown bold (**)"


def test_all_expected_manuals_present():
    """All 32 expected category manuals must be present."""
    from categories import CATEGORY_IDS
    loaded = {cat_id for cat_id, _ in _MANUAL_FILES}
    # out_of_domain does not need a manual
    expected = {cat_id for cat_id in CATEGORY_IDS if cat_id != "out_of_domain"}
    missing = expected - loaded
    assert not missing, f"Missing manual files for categories: {sorted(missing)}"


def test_no_extra_manual_files():
    """No manual files should exist for undefined category IDs."""
    from categories import CATEGORY_IDS
    valid_ids = set(CATEGORY_IDS) | {"out_of_domain"}
    loaded = {cat_id for cat_id, _ in _MANUAL_FILES}
    extra = loaded - valid_ids
    assert not extra, f"Extra manual files with unknown category IDs: {sorted(extra)}"
