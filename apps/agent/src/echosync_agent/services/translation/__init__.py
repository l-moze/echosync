from echosync_agent.services.translation.mock_translator import MockTranslator
from echosync_agent.services.translation.terminology import (
    DOMAIN_PRESETS,
    Glossary,
    GlossaryEntry,
    MatchedTerm,
    apply_glossary_replacements,
    get_domain_preset,
)

__all__ = [
    "DOMAIN_PRESETS",
    "Glossary",
    "GlossaryEntry",
    "MatchedTerm",
    "MockTranslator",
    "apply_glossary_replacements",
    "get_domain_preset",
]
