"""Keeps AI-written text in the syllabus's own style.

The review prompts ask the model to match the syllabus's voice and formatting. As a safety net, formatting
the original never uses is removed from everything the model writes: em dashes become commas or spaced
hyphens, and Markdown bold or italic markers are dropped. If the professor's syllabus uses them itself,
they're left alone. The same transformation applies to every model string (including the excerpts used to
match changes to suggestions), so matching still works.
"""

import re

# An em dash used in prose ("word — word"), not as an empty-cell placeholder ("| — |").
_PROSE_EM = re.compile(r"\w[\s ]*—[\s ]*\w")
_BOLD = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_BOLD_UNDERSCORE = re.compile(r"__(.+?)__", re.DOTALL)
_ITALIC = re.compile(r"(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])")


def rules_for(source: str) -> dict:
    """Which conventions the original syllabus uses, so only foreign ones are removed."""
    return {
        "em_dash": bool(_PROSE_EM.search(source)),
        "bold": "**" in source or "__" in source,
        "italic": bool(_ITALIC.search(source)),
    }


def tidy(text: str, rules: dict) -> str:
    if not isinstance(text, str) or not text:
        return text
    if not rules["em_dash"]:
        # "word — word" and "word—word" both read naturally as "word - word". A lone dash in a table cell stays.
        text = re.sub(r"(?<=\w)\s*\u2014\s*(?=\w)", " - ", text)
    if not rules["bold"]:
        text = _BOLD.sub(r"\1", text)
        text = _BOLD_UNDERSCORE.sub(r"\1", text)
    if not rules["italic"]:
        text = _ITALIC.sub(r"\1", text)
    return text
