from echosync_agent.services.realtime.text_emission_policy import TextEmissionPolicy


def test_policy_holds_short_cjk_source_partial_until_readable_chunk() -> None:
    policy = TextEmissionPolicy(source_cjk_min_chars=4)

    assert policy.should_hold_source_partial(current_text="你", last_emitted_text="") is True
    assert policy.should_hold_source_partial(current_text="你好世", last_emitted_text="") is True
    assert policy.should_hold_source_partial(current_text="你好世界", last_emitted_text="") is False


def test_policy_does_not_hold_latin_source_partial() -> None:
    policy = TextEmissionPolicy(source_cjk_min_chars=4)

    assert policy.should_hold_source_partial(current_text="Hello", last_emitted_text="") is False
    assert (
        policy.should_hold_source_partial(current_text="Hello world", last_emitted_text="Hello")
        is False
    )


def test_policy_flushes_target_on_readable_chunks_punctuation_final_and_rewrite() -> None:
    policy = TextEmissionPolicy(target_min_initial_chars=6, target_min_delta_chars=6)

    assert policy.should_emit_target(previous_text="", next_text="大") is False
    assert policy.should_emit_target(previous_text="", next_text="大家好欢迎大家") is True
    assert policy.should_emit_target(previous_text="大家好", next_text="大家好呀") is False
    assert policy.should_emit_target(previous_text="大家好", next_text="大家好呀。") is True
    assert policy.should_emit_target(previous_text="旧译文", next_text="新") is True
    assert (
        policy.should_emit_target(previous_text="大家好", next_text="大家好呀", is_final=True)
        is True
    )
