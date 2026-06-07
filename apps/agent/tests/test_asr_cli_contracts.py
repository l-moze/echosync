from __future__ import annotations

import argparse

from echosync_agent.asr_demo import build_arg_parser, build_transcriber
from echosync_agent.services.asr.deepgram_transcriber import DeepgramStreamingTranscriber
from echosync_agent.services.asr.funasr_transcriber import FunAsrTranscriber
from echosync_agent.services.asr.voxtral_transcriber import VoxtralRealtimeTranscriber


def test_asr_demo_cli_accepts_media_and_latency_options() -> None:
    parser = build_arg_parser()

    args = parser.parse_args(
        [
            "lecture.mp4",
            "--provider",
            "funasr",
            "--chunk-ms",
            "600",
            "--device",
            "cpu",
            "--source-lang",
            "zh",
        ]
    )

    assert isinstance(parser, argparse.ArgumentParser)
    assert args.media == "lecture.mp4"
    assert args.provider == "funasr"
    assert args.chunk_ms == 600
    assert args.device == "cpu"
    assert args.source_lang == "zh"


def test_asr_demo_cli_defaults_to_auto_device() -> None:
    parser = build_arg_parser()

    args = parser.parse_args(["lecture.mp4"])

    assert args.device == "auto"
    assert args.voxtral_delay_ms == 1000


def test_asr_demo_cli_accepts_voxtral_options() -> None:
    parser = build_arg_parser()

    args = parser.parse_args(
        [
            "lecture.mp4",
            "--provider",
            "voxtral",
            "--model",
            "voxtral-mini-transcribe-realtime-2602",
            "--mistral-api-key",
            "test-key",
            "--voxtral-delay-ms",
            "480",
        ]
    )

    assert args.provider == "voxtral"
    assert args.model == "voxtral-mini-transcribe-realtime-2602"
    assert args.mistral_api_key == "test-key"
    assert args.voxtral_delay_ms == 480


def test_asr_demo_cli_accepts_deepgram_options() -> None:
    parser = build_arg_parser()

    args = parser.parse_args(
        [
            "lecture.mp4",
            "--provider",
            "deepgram",
            "--model",
            "nova-3",
            "--deepgram-api-key",
            "test-key",
            "--deepgram-endpointing-ms",
            "200",
            "--source-lang",
            "en",
        ]
    )

    assert args.provider == "deepgram"
    assert args.model == "nova-3"
    assert args.deepgram_api_key == "test-key"
    assert args.deepgram_endpointing_ms == 200


def test_asr_demo_builds_deepgram_transcriber_from_cli_options() -> None:
    parser = build_arg_parser()
    args = parser.parse_args(
        [
            "lecture.mp4",
            "--provider",
            "deepgram",
            "--deepgram-api-key",
            "test-key",
            "--deepgram-endpointing-ms",
            "200",
            "--source-lang",
            "en",
        ]
    )

    transcriber = build_transcriber(args)

    assert isinstance(transcriber, DeepgramStreamingTranscriber)
    assert transcriber.config.model == "nova-3"
    assert transcriber.config.language == "en"
    assert transcriber.config.endpointing_ms == 200


def test_asr_demo_uses_voxtral_default_model_when_model_is_not_supplied() -> None:
    parser = build_arg_parser()

    args = parser.parse_args(
        [
            "lecture.mp4",
            "--provider",
            "voxtral",
            "--mistral-api-key",
            "test-key",
        ]
    )

    transcriber = build_transcriber(args)

    assert isinstance(transcriber, VoxtralRealtimeTranscriber)
    assert transcriber.config.model == "voxtral-mini-transcribe-realtime-2602"


def test_asr_demo_preserves_funasr_vad_env_options(monkeypatch) -> None:
    monkeypatch.setenv("FUNASR_VAD_ENABLED", "false")
    monkeypatch.setenv("FUNASR_VAD_SILENCE_MS", "240")
    monkeypatch.setenv("FUNASR_VAD_ACTIVATION_THRESHOLD", "0.42")

    parser = build_arg_parser()
    args = parser.parse_args(
        [
            "lecture.mp4",
            "--provider",
            "funasr",
            "--chunk-ms",
            "600",
            "--device",
            "cpu",
        ]
    )

    transcriber = build_transcriber(args)

    assert isinstance(transcriber, FunAsrTranscriber)
    assert transcriber.vad_detector is None
    assert transcriber.config.vad_silence_ms == 240
