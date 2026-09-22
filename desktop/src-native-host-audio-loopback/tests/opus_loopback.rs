//! Hosted synthetic Opus loopback: fixture PCM encode, relay-byte
//! round-trip, NetEq drain, and fault cases. No devices, no relay, no
//! network. Native compilation is hosted-only (`macos-14`).

use colony_native_host_audio::{
    audio_level_dbov, normalized_speaker_level, pcm_batch_is_decodable,
    validate_audio_batch_base64, validate_pcm_batch_bytes, FRAME_SAMPLES_20MS,
    MAX_AUDIO_BATCH_BYTES, PLAYOUT_SAMPLES_10MS,
};
use colony_native_host_audio_loopback::{
    encode_frame, relay_bytes, step, upstream_encoder, LoopbackDrain, CHANNELS, FRAME_DURATION_MS,
    PLAYOUT_SAMPLES_10MS as LOOPBACK_PLAYOUT, SAMPLE_RATE_HZ,
};

fn silence_960() -> Vec<f32> {
    vec![0.0; FRAME_SAMPLES_20MS]
}

fn full_scale_960() -> Vec<f32> {
    vec![1.0; FRAME_SAMPLES_20MS]
}

fn sine_960() -> Vec<f32> {
    (0..FRAME_SAMPLES_20MS)
        .map(|i| {
            let t = i as f32 / SAMPLE_RATE_HZ as f32;
            0.3 * (2.0 * core::f32::consts::PI * 1_000.0 * t).sin()
        })
        .collect()
}

fn encode_fixture(pcm: &[f32]) -> (Vec<u8>, colony_native_host_audio::FrameHeader, Vec<u8>) {
    let mut encoder = upstream_encoder().expect("encoder");
    let mut out = vec![0u8; 4000];
    let frame = encode_frame(&mut encoder, pcm, 0, 0, &mut out).expect("encodes");
    let wire = relay_bytes(7, &frame);
    (wire, frame.header, frame.opus)
}

#[test]
fn constants_match_upstream_transport() {
    assert_eq!(SAMPLE_RATE_HZ, 48_000);
    assert_eq!(CHANNELS, 1);
    assert_eq!(FRAME_DURATION_MS, 20);
    assert_eq!(LOOPBACK_PLAYOUT, PLAYOUT_SAMPLES_10MS);
    assert_eq!(LOOPBACK_PLAYOUT, 480);
}

#[test]
fn silence_round_trips_through_relay_bytes_and_neteq() {
    let (wire, header, opus) = encode_fixture(&silence_960());
    assert!(!opus.is_empty());
    let (peer, parsed, payload) =
        colony_native_host_audio::parse_relay_frame(&wire).expect("parses");
    assert_eq!(peer, 7);
    assert_eq!(parsed, header);
    assert_eq!(payload, opus.as_slice());
    assert_eq!(parsed.level_dbov, -127);

    let mut drain = LoopbackDrain::new(7).expect("drain");
    drain
        .insert(parsed.seq, parsed.ts_48k, payload.to_vec())
        .expect("insert");
    assert!(!drain.is_empty());
    let (samples, _vad) = drain.drain_10ms().expect("drains 10 ms");
    assert_eq!(samples.len(), 480);
}

#[test]
fn sine_level_flows_from_fixture_to_header_to_ui_norm() {
    let pcm = sine_960();
    let expected_level = audio_level_dbov(&pcm);
    assert!((-20..=-8).contains(&expected_level));
    let (_wire, header, _opus) = encode_fixture(&pcm);
    assert_eq!(header.level_dbov, expected_level);
    let norm = normalized_speaker_level(header.level_dbov);
    // Upstream-derived band, not tuned to observed output: wire.rs pins
    // this 0.3-amplitude 1 kHz sine to -20..=-8 dBov, and playout.rs
    // normalizes (db + 60) / 48, so the UI norm must land in
    // [40/48, 52/48 clamped to 1.0] = [0.833, 1.0].
    assert!(
        (0.833..=1.0).contains(&norm),
        "sine fixture norm {norm} outside upstream-derived band [0.833, 1.0]"
    );
}

#[test]
fn full_scale_encodes_with_zero_dbov() {
    let (_wire, header, _opus) = encode_fixture(&full_scale_960());
    assert_eq!(header.level_dbov, 0);
}

#[test]
fn sequential_frames_step_seq_and_ts_like_upstream() {
    let mut encoder = upstream_encoder().expect("encoder");
    let mut out = vec![0u8; 4000];
    let pcm = sine_960();
    let (mut seq, mut ts) = (0u16, 0u32);
    for i in 0..3u16 {
        let frame = encode_frame(&mut encoder, &pcm, seq, ts, &mut out).expect("encodes");
        assert_eq!(
            (frame.header.seq, frame.header.ts_48k),
            (i, u32::from(i) * 960)
        );
        (seq, ts) = step(seq, ts);
    }
    assert_eq!((seq, ts), (3, 3 * 960));
}

#[test]
fn fault_short_frame_empty_payload_and_bad_batches() {
    // Short frame and header-without-payload rejected.
    assert!(colony_native_host_audio::FrameHeader::parse(&[0u8; 7]).is_none());
    let header = colony_native_host_audio::FrameHeader {
        seq: 1,
        ts_48k: 960,
        level_dbov: -40,
        flags: 0,
    };
    let mut header_only = vec![7u8];
    header_only.extend_from_slice(&header.encode());
    assert!(colony_native_host_audio::parse_relay_frame(&header_only).is_none());
    // IPC profile: oversize rejected, %4 mismatch skipped-never-errored.
    assert!(validate_pcm_batch_bytes(MAX_AUDIO_BATCH_BYTES + 1).is_err());
    assert!(!pcm_batch_is_decodable(19_201));
    assert!(validate_audio_batch_base64(136_536, 102_401).is_err());
}

#[test]
fn empty_drain_still_emits_expand_frame() {
    let mut drain = LoopbackDrain::new(0).expect("drain");
    assert!(drain.is_empty());
    let (samples, vad) = drain.drain_10ms().expect("expand frame");
    assert_eq!(samples.len(), 480);
    assert!(!vad);
}
