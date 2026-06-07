use std::collections::VecDeque;
use std::env;
use std::io::{self, Write};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde_json::json;
use wasapi::{initialize_mta, AudioClient, Direction, SampleType, StreamMode, WaveFormat};

const AUDIO_FRAME_MAGIC: u32 = 0x4641_5345;
const AUDIO_FRAME_VERSION: u16 = 1;
const TARGET_SAMPLE_RATE: usize = 16_000;
const CAPTURE_SAMPLE_RATE: usize = 48_000;
const CAPTURE_CHANNELS: usize = 2;
const CAPTURE_BYTES_PER_SAMPLE: usize = 4;
const FRAME_DURATION_MS: usize = 80;
const TARGET_SAMPLES_PER_FRAME: usize = TARGET_SAMPLE_RATE * FRAME_DURATION_MS / 1000;
const CAPTURE_FRAMES_PER_OUTPUT_FRAME: usize = CAPTURE_SAMPLE_RATE * FRAME_DURATION_MS / 1000;
const CAPTURE_BYTES_PER_OUTPUT_FRAME: usize =
    CAPTURE_FRAMES_PER_OUTPUT_FRAME * CAPTURE_CHANNELS * CAPTURE_BYTES_PER_SAMPLE;

#[derive(Debug)]
struct Cli {
    mode: CaptureMode,
    pid: u32,
    session_id: String,
}

#[derive(Clone, Copy, Debug)]
enum CaptureMode {
    ExcludeProcessTree,
    IncludeProcessTree,
}

impl CaptureMode {
    fn include_tree(self) -> bool {
        matches!(self, CaptureMode::IncludeProcessTree)
    }

    fn event_name(self) -> &'static str {
        match self {
            CaptureMode::ExcludeProcessTree => "wasapi.exclude_process_tree",
            CaptureMode::IncludeProcessTree => "wasapi.include_process_tree",
        }
    }
}

#[derive(Debug)]
struct AudioFrame {
    seq: u32,
    start_ms: u32,
    end_ms: u32,
    pcm: Vec<u8>,
    captured_at_ms: u32,
    resample_ms: f64,
    encode_ms: f64,
}

#[derive(Debug)]
struct CaptureStats {
    callbacks: u64,
    raw_bytes: u64,
    output_frames: u64,
    max_capture_queue_bytes: usize,
    last_wakeup_at: Option<Instant>,
    wakeup_intervals_ms: Vec<f64>,
    resample_ms: Vec<f64>,
    encode_ms: Vec<f64>,
    write_ms: Vec<f64>,
    started_at: Instant,
}

impl CaptureStats {
    fn new() -> Self {
        Self {
            callbacks: 0,
            raw_bytes: 0,
            output_frames: 0,
            max_capture_queue_bytes: 0,
            last_wakeup_at: None,
            wakeup_intervals_ms: Vec::new(),
            resample_ms: Vec::new(),
            encode_ms: Vec::new(),
            write_ms: Vec::new(),
            started_at: Instant::now(),
        }
    }

    fn record_capture_callback(&mut self, bytes: usize, queue_len: usize, now: Instant) {
        self.callbacks += 1;
        self.raw_bytes += bytes as u64;
        self.max_capture_queue_bytes = self.max_capture_queue_bytes.max(queue_len);
        if let Some(last) = self.last_wakeup_at.replace(now) {
            self.wakeup_intervals_ms
                .push(duration_ms(now.saturating_duration_since(last)));
        }
    }

    fn record_frame(&mut self, frame: &AudioFrame, write_ms: f64) {
        self.output_frames += 1;
        self.resample_ms.push(frame.resample_ms);
        self.encode_ms.push(frame.encode_ms);
        self.write_ms.push(write_ms);
    }

    fn should_flush(&self) -> bool {
        self.started_at.elapsed() >= Duration::from_secs(1)
    }

    fn flush(&mut self, session_id: &str, mode: CaptureMode, pid: u32) {
        if self.callbacks == 0 && self.output_frames == 0 {
            self.started_at = Instant::now();
            return;
        }
        eprintln!(
            "{}",
            json!({
                "event": "wasapi_capture_metrics",
                "session_id": session_id,
                "capture_mode": mode.event_name(),
                "target_pid": pid,
                "window_ms": duration_ms(self.started_at.elapsed()),
                "callbacks": self.callbacks,
                "raw_bytes": self.raw_bytes,
                "output_frames": self.output_frames,
                "max_capture_queue_bytes": self.max_capture_queue_bytes,
                "avg_wakeup_interval_ms": avg(&self.wakeup_intervals_ms),
                "p95_wakeup_interval_ms": percentile(&self.wakeup_intervals_ms, 0.95),
                "avg_resample_ms": avg(&self.resample_ms),
                "p95_resample_ms": percentile(&self.resample_ms, 0.95),
                "avg_encode_ms": avg(&self.encode_ms),
                "p95_encode_ms": percentile(&self.encode_ms, 0.95),
                "avg_stdout_write_ms": avg(&self.write_ms),
                "p95_stdout_write_ms": percentile(&self.write_ms, 0.95),
            })
        );
        *self = Self::new();
    }
}

fn main() -> Result<()> {
    let cli = parse_cli(env::args().skip(1))?;
    eprintln!(
        "{}",
        json!({
            "event": "wasapi_sidecar_started",
            "session_id": cli.session_id,
            "capture_mode": cli.mode.event_name(),
            "target_pid": cli.pid,
            "sample_rate": TARGET_SAMPLE_RATE,
            "channels": 1,
            "frame_duration_ms": FRAME_DURATION_MS,
            "stdout_protocol": "length-prefixed-pcm16-binary-v1",
        })
    );

    capture_loop(cli)
}

fn capture_loop(cli: Cli) -> Result<()> {
    let _ = initialize_mta();
    let desired_format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        CAPTURE_SAMPLE_RATE,
        CAPTURE_CHANNELS,
        None,
    );
    let mut audio_client = AudioClient::new_application_loopback_client(cli.pid, cli.mode.include_tree())
        .with_context(|| {
            format!(
                "无法创建 Windows Application Loopback client：mode={:?}, pid={}",
                cli.mode, cli.pid
            )
        })?;
    audio_client.initialize_client(
        &desired_format,
        &Direction::Capture,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: 0,
        },
    )?;
    let event = audio_client.set_get_eventhandle()?;
    let capture_client = audio_client.get_audiocaptureclient()?;
    let blockalign = desired_format.get_blockalign() as usize;
    let mut raw_queue = VecDeque::<u8>::with_capacity(CAPTURE_BYTES_PER_OUTPUT_FRAME * 4);
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    let mut seq = 0u32;
    let mut capture_cursor_samples = 0usize;
    let mut stats = CaptureStats::new();

    audio_client.start_stream()?;
    loop {
        let now = Instant::now();
        let packet_frames = capture_client.get_next_packet_size()?.unwrap_or(0);
        if packet_frames > 0 {
            let before = raw_queue.len();
            capture_client.read_from_device_to_deque(&mut raw_queue)?;
            let bytes_read = raw_queue.len().saturating_sub(before);
            stats.record_capture_callback(bytes_read, raw_queue.len(), now);
        }

        while raw_queue.len() >= CAPTURE_BYTES_PER_OUTPUT_FRAME {
            let mut chunk = vec![0u8; CAPTURE_BYTES_PER_OUTPUT_FRAME];
            for item in &mut chunk {
                *item = raw_queue
                    .pop_front()
                    .ok_or_else(|| anyhow!("WASAPI 原始采集队列为空"))?;
            }
            let mono = downmix_float32_stereo_to_mono(&chunk, blockalign)?;
            let resample_started = Instant::now();
            let resampled = resample_48k_to_16k(&mono);
            let resample_ms = duration_ms(resample_started.elapsed());
            let encode_started = Instant::now();
            let pcm = float_to_pcm16(&resampled);
            let encode_ms = duration_ms(encode_started.elapsed());
            let start_ms = samples_to_ms(capture_cursor_samples);
            capture_cursor_samples += TARGET_SAMPLES_PER_FRAME;
            let end_ms = samples_to_ms(capture_cursor_samples);
            seq = seq.wrapping_add(1);
            let frame = AudioFrame {
                seq,
                start_ms,
                end_ms,
                pcm,
                captured_at_ms: now_ms_low32(),
                resample_ms,
                encode_ms,
            };
            let write_started = Instant::now();
            write_length_prefixed_frame(&mut stdout, &frame)?;
            let write_ms = duration_ms(write_started.elapsed());
            stats.record_frame(&frame, write_ms);
        }

        if stats.should_flush() {
            stats.flush(&cli.session_id, cli.mode, cli.pid);
        }

        if event.wait_for_event(1000).is_err() {
            eprintln!(
                "{}",
                json!({
                    "event": "wasapi_capture_wait_timeout",
                    "session_id": cli.session_id,
                    "capture_mode": cli.mode.event_name(),
                    "target_pid": cli.pid,
                })
            );
        }
    }
}

fn write_length_prefixed_frame(writer: &mut impl Write, frame: &AudioFrame) -> Result<()> {
    let packet = create_binary_audio_frame(frame);
    writer.write_all(&(packet.len() as u32).to_le_bytes())?;
    writer.write_all(&packet)?;
    writer.flush()?;
    Ok(())
}

fn create_binary_audio_frame(frame: &AudioFrame) -> Vec<u8> {
    let mut packet = Vec::with_capacity(24 + frame.pcm.len());
    packet.extend_from_slice(&AUDIO_FRAME_MAGIC.to_le_bytes());
    packet.extend_from_slice(&AUDIO_FRAME_VERSION.to_le_bytes());
    packet.extend_from_slice(&0u16.to_le_bytes());
    packet.extend_from_slice(&frame.seq.to_le_bytes());
    packet.extend_from_slice(&frame.start_ms.to_le_bytes());
    packet.extend_from_slice(&frame.end_ms.to_le_bytes());
    packet.extend_from_slice(&frame.captured_at_ms.to_le_bytes());
    packet.extend_from_slice(&frame.pcm);
    packet
}

fn downmix_float32_stereo_to_mono(chunk: &[u8], blockalign: usize) -> Result<Vec<f32>> {
    if blockalign != CAPTURE_CHANNELS * CAPTURE_BYTES_PER_SAMPLE {
        return Err(anyhow!(
            "当前 sidecar 只支持 48kHz float32 stereo，实际 blockalign={blockalign}"
        ));
    }
    let frames = chunk.len() / blockalign;
    let mut mono = Vec::with_capacity(frames);
    for frame in 0..frames {
        let offset = frame * blockalign;
        let left = f32::from_le_bytes(chunk[offset..offset + 4].try_into()?);
        let right = f32::from_le_bytes(chunk[offset + 4..offset + 8].try_into()?);
        mono.push(((left + right) * 0.5).clamp(-1.0, 1.0));
    }
    Ok(mono)
}

fn resample_48k_to_16k(samples: &[f32]) -> Vec<f32> {
    let mut output = Vec::with_capacity(samples.len() / 3);
    for chunk in samples.chunks_exact(3) {
        output.push((chunk[0] + chunk[1] + chunk[2]) / 3.0);
    }
    output
}

fn float_to_pcm16(samples: &[f32]) -> Vec<u8> {
    let mut pcm = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = if clamped < 0.0 {
            (clamped * 32768.0) as i16
        } else {
            (clamped * 32767.0) as i16
        };
        pcm.extend_from_slice(&value.to_le_bytes());
    }
    pcm
}

fn samples_to_ms(samples: usize) -> u32 {
    ((samples as u64 * 1000) / TARGET_SAMPLE_RATE as u64) as u32
}

fn now_ms_low32() -> u32 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    millis as u32
}

fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

fn avg(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

fn percentile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.total_cmp(right));
    let index = ((sorted.len() - 1) as f64 * percentile).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn parse_cli(args: impl Iterator<Item = String>) -> Result<Cli> {
    let mut mode = CaptureMode::ExcludeProcessTree;
    let mut pid: Option<u32> = None;
    let mut session_id: Option<String> = None;
    let mut args = args.peekable();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--mode" => {
                let value = args.next().ok_or_else(|| anyhow!("--mode 缺少值"))?;
                mode = match value.as_str() {
                    "exclude-process-tree" => CaptureMode::ExcludeProcessTree,
                    "include-process-tree" => CaptureMode::IncludeProcessTree,
                    _ => return Err(anyhow!("不支持的 --mode：{value}")),
                };
            }
            "--pid" => {
                let value = args.next().ok_or_else(|| anyhow!("--pid 缺少值"))?;
                pid = Some(value.parse::<u32>().context("--pid 必须是正整数")?);
            }
            "--session-id" => {
                session_id = Some(args.next().ok_or_else(|| anyhow!("--session-id 缺少值"))?);
            }
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            _ => return Err(anyhow!("未知参数：{arg}")),
        }
    }

    Ok(Cli {
        mode,
        pid: pid.ok_or_else(|| anyhow!("缺少 --pid"))?,
        session_id: session_id.ok_or_else(|| anyhow!("缺少 --session-id"))?,
    })
}

fn print_help() {
    println!(
        "EchoSync WASAPI sidecar\n\n用法:\n  echosync-wasapi-sidecar --pid <PID> --session-id <SESSION> [--mode exclude-process-tree|include-process-tree]\n"
    );
}
