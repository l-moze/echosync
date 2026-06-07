#!/usr/bin/env python3
"""DeepL Text API latency benchmark for realtime subtitle feasibility.

Usage:
    python deepl_latency_benchmark.py

Environment:
    DEEPL_API_KEY: DeepL API key (required)
    DEEPL_BASE_URL: Optional, defaults to free API endpoint

This script measures:
1. End-to-end request latency (p50/p95/p99)
2. Latency by source text length
3. Prefix instability (translation variance across growing prefixes)
4. Suitability for realtime subtitle use case

Decision criteria:
- p50 < 600ms: Good for realtime
- p95 < 1000ms: Acceptable
- p50 > 800ms: Not recommended, stick with DeepSeek
"""

from __future__ import annotations

import asyncio
import json
import os
import statistics
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class LatencyMeasurement:
    source_text: str
    target_text: str
    latency_ms: float
    source_chars: int
    target_chars: int
    model_type_used: str
    detected_source_lang: str


async def measure_single_request(
    api_key: str,
    base_url: str,
    source_text: str,
    source_lang: str,
    target_lang: str,
) -> LatencyMeasurement:
    """Measure a single DeepL translation request."""
    from urllib.request import Request, urlopen

    started_at = time.perf_counter()

    body = {
        "text": [source_text],
        "source_lang": source_lang,
        "target_lang": target_lang,
        "model_type": "latency_optimized",
        "split_sentences": "0",
        "preserve_formatting": True,
    }

    headers = {
        "Authorization": f"DeepL-Auth-Key {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "EchoSync-DeepL-Benchmark/0.1",
    }

    request = Request(
        base_url,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    def _sync_request() -> dict:
        with urlopen(request, timeout=15.0) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))

    payload = await asyncio.to_thread(_sync_request)
    latency_ms = (time.perf_counter() - started_at) * 1000

    translations = payload.get("translations", [])
    if not translations:
        raise RuntimeError("DeepL response did not contain translations")

    first = translations[0]
    target_text = first.get("text", "")
    detected_source = first.get("detected_source_language", "")
    model_type_used = payload.get("model_type_used", "")

    return LatencyMeasurement(
        source_text=source_text,
        target_text=target_text,
        latency_ms=latency_ms,
        source_chars=len(source_text),
        target_chars=len(target_text),
        model_type_used=model_type_used,
        detected_source_lang=detected_source,
    )


async def benchmark_latency(api_key: str, base_url: str) -> None:
    """Run comprehensive latency benchmark."""
    print("=" * 80)
    print("DeepL Text API Latency Benchmark (latency_optimized)")
    print("=" * 80)
    print()

    # Test cases: growing prefixes simulating realtime ASR
    test_cases = [
        # Short phrases (early translation triggers)
        "Today we are going to",
        "Today we are going to talk about",
        "Today we are going to talk about streaming translation",
        # Medium sentences
        "Today we are going to talk about streaming translation in production environments",
        "Today we are going to talk about streaming translation in production environments and how to reduce latency",
        # Long sentences
        "Today we are going to talk about streaming translation in production environments and how to reduce latency while maintaining translation quality using DeepL Text API",
        # Additional diverse samples
        "Hello, my name is",
        "Hello, my name is Claude and I will",
        "Hello, my name is Claude and I will demonstrate realtime subtitle translation",
        "This is one of the most important",
        "This is one of the most important problems in simultaneous interpretation",
        "The quick brown fox jumps",
        "The quick brown fox jumps over the lazy dog and continues running",
    ]

    measurements: list[LatencyMeasurement] = []

    print(f"Running {len(test_cases)} translation requests...\n")

    for i, source_text in enumerate(test_cases, 1):
        try:
            measurement = await measure_single_request(
                api_key=api_key,
                base_url=base_url,
                source_text=source_text,
                source_lang="EN",
                target_lang="ZH",
            )
            measurements.append(measurement)

            print(f"[{i:2d}/{len(test_cases)}] {measurement.latency_ms:6.1f}ms | "
                  f"{measurement.source_chars:3d} chars | {source_text[:50]}")

            # Rate limiting: ~0.5s between requests
            await asyncio.sleep(0.5)

        except Exception as exc:
            print(f"[{i:2d}/{len(test_cases)}] ERROR: {exc}")

    if not measurements:
        print("\nERROR: No successful measurements")
        return

    # Compute statistics
    latencies = [m.latency_ms for m in measurements]
    p50 = statistics.median(latencies)
    p95 = statistics.quantiles(latencies, n=20)[18] if len(latencies) >= 20 else max(latencies)
    p99 = statistics.quantiles(latencies, n=100)[98] if len(latencies) >= 100 else max(latencies)
    avg = statistics.mean(latencies)
    min_lat = min(latencies)
    max_lat = max(latencies)

    # Group by source length
    short = [m for m in measurements if m.source_chars < 30]
    medium = [m for m in measurements if 30 <= m.source_chars < 80]
    long = [m for m in measurements if m.source_chars >= 80]

    print()
    print("=" * 80)
    print("Latency Summary")
    print("=" * 80)
    print(f"Total requests:  {len(measurements)}")
    print(f"Average:         {avg:.1f}ms")
    print(f"p50 (median):    {p50:.1f}ms")
    print(f"p95:             {p95:.1f}ms")
    print(f"p99:             {p99:.1f}ms")
    print(f"Min:             {min_lat:.1f}ms")
    print(f"Max:             {max_lat:.1f}ms")
    print()

    # Latency by length
    print("Latency by Source Length")
    print("-" * 80)
    if short:
        short_latencies = [m.latency_ms for m in short]
        print(f"Short (< 30 chars):   n={len(short):2d}  median={statistics.median(short_latencies):6.1f}ms")
    if medium:
        medium_latencies = [m.latency_ms for m in medium]
        print(f"Medium (30-80):       n={len(medium):2d}  median={statistics.median(medium_latencies):6.1f}ms")
    if long:
        long_latencies = [m.latency_ms for m in long]
        print(f"Long (>= 80 chars):   n={len(long):2d}  median={statistics.median(long_latencies):6.1f}ms")
    print()

    # Prefix instability analysis
    print("Prefix Instability Analysis")
    print("-" * 80)
    print("Growing prefixes (simulating ASR incremental output):")
    print()

    prefix_groups = [
        measurements[0:3],   # "Today we are..." group
        measurements[6:9],   # "Hello, my name..." group
        measurements[9:11],  # "This is one..." group
    ]

    for group in prefix_groups:
        if len(group) < 2:
            continue
        print(f"  Source prefix: {group[0].source_text[:40]}...")
        for m in group:
            print(f"    {m.source_chars:3d} chars → {m.target_text}")
        print()

    # Decision recommendation
    print("=" * 80)
    print("Recommendation for Realtime Subtitle Use")
    print("=" * 80)

    if p50 < 600:
        verdict = "✓ GOOD - Suitable for realtime use"
        recommendation = "DeepL latency_optimized is fast enough for realtime subtitles."
    elif p50 < 800:
        verdict = "~ MARGINAL - Consider user tolerance"
        recommendation = "Latency is acceptable but not ideal. DeepSeek may be better for low-latency scenarios."
    else:
        verdict = "✗ NOT RECOMMENDED - Too slow"
        recommendation = "Latency too high for realtime subtitles. Stick with DeepSeek streaming."

    print(f"p50 Latency:     {p50:.1f}ms")
    print(f"Verdict:         {verdict}")
    print(f"Recommendation:  {recommendation}")
    print()

    if p50 < 600:
        print("Next steps:")
        print("  1. Implement Phase 1: DeepLRealtimeCoordinator with Fast Lane")
        print("  2. Implement local agreement for prefix stability")
        print("  3. Test with real video (vido/videoplayback.mp4)")
    else:
        print("Next steps:")
        print("  1. Keep DeepSeek as primary realtime translator")
        print("  2. Consider DeepL only for batch/quality revision scenarios")
    print()


def main() -> None:
    api_key = os.getenv("DEEPL_API_KEY", "").strip()
    if not api_key:
        print("ERROR: DEEPL_API_KEY environment variable not set")
        print()
        print("Please set your DeepL API key:")
        print("  export DEEPL_API_KEY=your_key_here")
        print("  python deepl_latency_benchmark.py")
        return

    base_url = os.getenv("DEEPL_BASE_URL", "https://api-free.deepl.com/v2/translate").strip()

    print(f"Using DeepL endpoint: {base_url}")
    print()

    asyncio.run(benchmark_latency(api_key, base_url))


if __name__ == "__main__":
    main()
