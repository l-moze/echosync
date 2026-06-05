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
