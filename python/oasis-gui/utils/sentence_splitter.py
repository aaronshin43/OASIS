import re

_SENTENCE_RE = re.compile(r'.*?([。！？!?，,]|\.)(?=\s|$)', re.DOTALL)
_EMOJI_SPECIAL_RE = re.compile(r'[*#~]|[\U0001F300-\U0001FAFF\u200d\ufe0f]')

# ── TTS text normalization ─────────────────────────────────────────────────────

# Emergency/hotline numbers — read digit by digit
# Uses negative lookarounds to avoid partial matches (e.g. 9110 untouched)
_DIGIT_BY_DIGIT: list[tuple[re.Pattern, str]] = [
    (re.compile(r'(?<!\d)9-?1-?1(?!\d)'), "nine one one"),
    (re.compile(r'(?<!\d)9-?8-?8(?!\d)'), "nine eight eight"),
]

_ONES = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def _num_to_words(n: int) -> str:
    """Convert integer 0–999 to English words."""
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return _TENS[tens] + (f" {_ONES[ones]}" if ones else "")
    hundreds, rest = divmod(n, 100)
    return _ONES[hundreds] + " hundred" + (f" {_num_to_words(rest)}" if rest else "")


def _replace_range(m: re.Match) -> str:
    """Replace numeric range e.g. '5-10' → 'five to ten'."""
    a, b = int(m.group(1)), int(m.group(2))
    return f"{_num_to_words(a)} to {_num_to_words(b)}"


# Unit substitutions: pattern → replacement (applied after range expansion)
_UNIT_SUBS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bcm\b'),  "centimeters"),
    (re.compile(r'\bmm\b'),  "millimeters"),
    (re.compile(r'\bmg\b'),  "milligrams"),
    (re.compile(r'\bml\b'),  "milliliters"),
    (re.compile(r'\bkg\b'),  "kilograms"),
    (re.compile(r'°C\b'),    "degrees Celsius"),
    (re.compile(r'°F\b'),    "degrees Fahrenheit"),
]

_RANGE_RE = re.compile(r'\b(\d{1,3})-(\d{1,3})\b')


def _normalize_for_tts(text: str) -> str:
    """Expand abbreviations and numbers for natural TTS pronunciation.

    Applied only to TTS input — display text is unchanged.
    """
    # 1. Digit-by-digit emergency numbers
    for pattern, spoken in _DIGIT_BY_DIGIT:
        text = pattern.sub(spoken, text)

    # 2. Numeric ranges: 5-10 → five to ten
    text = _RANGE_RE.sub(_replace_range, text)

    # 3. Unit abbreviations
    for pattern, replacement in _UNIT_SUBS:
        text = pattern.sub(replacement, text)

    return text


# ── Public API ─────────────────────────────────────────────────────────────────

def split_sentences(text: str) -> tuple[list[str], str]:
    """Split text at sentence boundaries. Returns (complete_sentences, remaining_buffer).

    Ported from src/utils/index.ts splitSentences().
    - Boundaries: . ! ? , followed by whitespace or end of string
    - Merges short sentences (<=60 chars combined) for natural TTS pacing
    """
    sentences = []
    last_index = 0
    for match in _SENTENCE_RE.finditer(text):
        sentence = match.group(0).strip()
        if sentence:
            sentences.append(sentence)
            last_index = match.end()

    remaining = text[last_index:].strip()

    # Merge short sentences (<=60 chars) — matches TS implementation
    merged = []
    buf = ""
    for s in sentences:
        candidate = f"{buf}{s} "
        if len(candidate) <= 60:
            buf = candidate
        else:
            if buf:
                merged.append(buf.rstrip())
            buf = f"{s} "
    if buf:
        merged.append(buf.rstrip())

    return merged, remaining


def purify_for_tts(text: str) -> str:
    """Normalize and clean text for TTS input.

    1. Expand numbers/abbreviations for natural pronunciation.
    2. Remove characters unsuitable for TTS (emojis, markdown chars).
    """
    text = _normalize_for_tts(text)
    return _EMOJI_SPECIAL_RE.sub("", text).strip()
