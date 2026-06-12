from echosync_agent.services.realtime.hypothesis_update_policy import HypothesisUpdatePolicy


def test_policy_appends_short_delta_to_current_text() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="Hello", incoming_text=", world")

    assert result.text == "Hello, world"
    assert result.mode == "append_delta"


def test_policy_appends_plain_token_delta_to_current_text() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="abc", incoming_text="def")

    assert result.text == "abcdef"
    assert result.mode == "append_delta"


def test_policy_appends_bare_english_word_delta_after_phrase() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="Hello, my name is", incoming_text="Eevee")

    assert result.text == "Hello, my name is Eevee"
    assert result.mode == "append_delta"


def test_policy_appends_bare_english_word_delta_after_punctuation() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(
        current_text="Feels funny to say that at normal speed,",
        incoming_text="but",
    )

    assert result.text == "Feels funny to say that at normal speed, but"
    assert result.mode == "append_delta"


def test_policy_joins_latin_word_continuation_delta_without_extra_space() -> None:
    policy = HypothesisUpdatePolicy()

    first = policy.apply(current_text="The task checks ident", incoming_text="ifi")
    second = policy.apply(current_text=first.text, incoming_text="ability")

    assert first.text == "The task checks identifi"
    assert second.text == "The task checks identifiability"
    assert second.mode == "append_delta"


def test_policy_keeps_space_before_common_short_words() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="I would like", incoming_text="to")

    assert result.text == "I would like to"
    assert result.mode == "append_delta"


def test_policy_replaces_with_full_hypothesis_when_incoming_contains_current_prefix() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="Hello wor", incoming_text="Hello world")

    assert result.text == "Hello world"
    assert result.mode == "replace_hypothesis"


def test_policy_replaces_when_source_revises_previous_words() -> None:
    policy = HypothesisUpdatePolicy()

    result = policy.apply(current_text="I scream", incoming_text="ice cream")

    assert result.text == "ice cream"
    assert result.mode == "replace_hypothesis"


def test_policy_preserves_longer_text_when_incoming_is_truncated() -> None:
    """Bug fix: prevent ASR COMMITTED (shorter) from truncating PARTIAL (longer)."""
    policy = HypothesisUpdatePolicy()

    # Real case from bug report: PARTIAL has 133 chars, COMMITTED has 77 chars
    current = "an extremely resource-intensive research topic, can we also scale the science to allow the community to drive the collective progress"
    incoming = "an extremely resource-intensive research topic, can we also scale the science"

    result = policy.apply(current_text=current, incoming_text=incoming)

    # Should preserve the longer current text
    assert result.text == current
    assert len(result.text) == 133
    assert result.mode == "replace_hypothesis"


def test_policy_replaces_with_longer_text_when_incoming_extends_current() -> None:
    """Ensure we still replace when incoming is longer (normal case)."""
    policy = HypothesisUpdatePolicy()

    current = "an extremely resource-intensive research topic"
    incoming = "an extremely resource-intensive research topic, can we also scale the science"

    result = policy.apply(current_text=current, incoming_text=incoming)

    # Should use the longer incoming text
    assert result.text == incoming
    assert len(result.text) > len(current)
    assert result.mode == "replace_hypothesis"


def test_policy_replaces_with_equal_length_text() -> None:
    """Edge case: equal length should still replace (may have corrections)."""
    policy = HypothesisUpdatePolicy()

    current = "an extremely resource-intensive research topic"
    incoming = "an extremely resource intensive research topics"  # Same length, different words

    result = policy.apply(current_text=current, incoming_text=incoming)

    # Should replace with incoming (equal length is okay)
    assert result.text == incoming
    assert result.mode == "replace_hypothesis"

