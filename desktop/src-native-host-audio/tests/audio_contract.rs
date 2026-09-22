//! Hosted-gate contract tests for the isolated audio/PCM lane.
//!
//! Every test here is synthetic and std-only: fixed byte vectors, fixed
//! sequence numbers, fixed device-name strings. No microphone, speaker,
//! relay, network, filesystem device, or Electron surface is touched.
//! Passing these tests proves the contract codec/validator behavior only;
//! real capture/playout, Opus, NetEq, relay audio sockets, and renderer
//! playback remain future hosted gates (see the crate README and the lane
//! ticket artifact).

use colony_native_host_audio::{
    audio_backpressure, audio_level_dbov, expected_ts_delta, generation_is_current, next_seq,
    next_ts_48k, normalized_speaker_level, parse_relay_frame, pcm_batch_is_decodable, seq_is_newer,
    transition_audio_request, validate_audio_batch_base64, validate_bounded_base64_field,
    validate_output_device_name, validate_pcm_batch_bytes, validate_pcm_frame_samples,
    AudioRequestEvent, AudioRequestState, FrameHeader, CHANNELS, FLAG_DTX, FRAME_SAMPLES_20MS,
    FRAME_TIMESTAMP_DELTA, MAX_AUDIO_BATCH_BYTES, MAX_BINARY_BYTES_PER_FRAME,
    MAX_OPUS_PACKET_BYTES, PCM_QUEUE_DEPTH, PLAYOUT_SAMPLES_10MS, PLAYOUT_TICK_MS,
    PROTOCOL_VERSION, SAMPLE_RATE_HZ, V2_HEADER_LEN,
};

#[test]
fn pcm_constants_match_upstream_huddle_transport() {
    assert_eq!(SAMPLE_RATE_HZ, 48_000);
    assert_eq!(CHANNELS, 1);
    assert_eq!(FRAME_SAMPLES_20MS, 960);
    assert_eq!(FRAME_TIMESTAMP_DELTA, 960);
    assert_eq!(PLAYOUT_TICK_MS, 10);
    assert_eq!(PLAYOUT_SAMPLES_10MS, 480);
    assert_eq!(PROTOCOL_VERSION, 2);
    assert_eq!(V2_HEADER_LEN, 8);
    assert_eq!(PCM_QUEUE_DEPTH, 50);
    // Upstream IPC gate (huddle/mod.rs) and encoder output buffers
    // (relay_api.rs send loop, jitter.rs silence fixture).
    assert_eq!(MAX_AUDIO_BATCH_BYTES, 100 * 1024);
    assert_eq!(MAX_OPUS_PACKET_BYTES, 4000);
}

#[test]
fn header_encode_parse_round_trip_with_payload_remainder() {
    let header = FrameHeader {
        seq: 1000,
        ts_48k: 960_000,
        level_dbov: -20,
        flags: 0,
    };
    let mut wire = header.encode().to_vec();
    wire.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);
    let (parsed, rest) = FrameHeader::parse(&wire).expect("header parses");
    assert_eq!(parsed, header);
    assert_eq!(rest, &[0xDE, 0xAD, 0xBE, 0xEF]);
    assert!(!parsed.is_dtx());
}

#[test]
fn header_matches_upstream_fixture_vectors() {
    // Vectors from wire.rs@origin/develop: round-trip fixture
    // (seq 0xABCD, ts 0x12345678) and the network-byte-order fixture
    // (seq 0x0102 -> [0x01, 0x02], ts 0x03040506 -> [0x03..0x06],
    // level -1 -> 0xFF).
    let header = FrameHeader {
        seq: 0xABCD,
        ts_48k: 0x1234_5678,
        level_dbov: -30,
        flags: FLAG_DTX,
    };
    let encoded = header.encode();
    let (parsed, tail) = FrameHeader::parse(&encoded).expect("parses");
    assert_eq!(parsed, header);
    assert!(tail.is_empty());

    let ordered = FrameHeader {
        seq: 0x0102,
        ts_48k: 0x0304_0506,
        level_dbov: -1,
        flags: 0,
    }
    .encode();
    assert_eq!(ordered[0..2], [0x01, 0x02]);
    assert_eq!(ordered[2..6], [0x03, 0x04, 0x05, 0x06]);
    assert_eq!(ordered[6], 0xFF);
    assert_eq!(ordered[7], 0x00);
}

#[test]
fn relay_frame_matches_upstream_prefix_and_payload_rules() {
    // wire.rs@origin/develop: peer_index 7 + header + b"opus" parses;
    // a header with no payload is rejected.
    let header = FrameHeader {
        seq: 0x0102,
        ts_48k: 0x0102 * 960,
        level_dbov: -40,
        flags: 0,
    };
    let mut frame = vec![7u8];
    frame.extend_from_slice(&header.encode());
    frame.extend_from_slice(b"opus");
    let (peer, parsed, payload) = parse_relay_frame(&frame).expect("parses");
    assert_eq!(peer, 7);
    assert_eq!(parsed, header);
    assert_eq!(payload, b"opus");

    let mut header_only = vec![7u8];
    header_only.extend_from_slice(&header.encode());
    assert!(parse_relay_frame(&header_only).is_none());
    assert!(parse_relay_frame(&[]).is_none());
}

#[test]
fn level_ports_match_upstream_vectors() {
    // Vectors from wire.rs@origin/develop audio_level_dbov tests.
    assert_eq!(audio_level_dbov(&[]), -127);
    assert_eq!(audio_level_dbov(&[0.0_f32; 960]), -127);
    assert_eq!(audio_level_dbov(&[1.0_f32; 960]), 0);
    let sine: Vec<f32> = (0..960)
        .map(|i| {
            let t = i as f32 / 48_000.0;
            0.3 * (2.0 * core::f32::consts::PI * 1_000.0 * t).sin()
        })
        .collect();
    assert!((-20..=-8).contains(&audio_level_dbov(&sine)));
    // playout.rs normalized_speaker_level: (db + 60) / 48 clamped.
    assert_eq!(normalized_speaker_level(-127), 0.0);
    assert_eq!(normalized_speaker_level(0), 1.0);
    assert!((normalized_speaker_level(-36) - 0.5).abs() < 1e-6);
}

#[test]
fn seq_and_ts_step_like_the_upstream_send_loop() {
    // relay_api.rs: seq/ts start at 0, wrapping_add(1)/wrapping_add(960).
    let (mut seq, mut ts) = (0u16, 0u32);
    for _ in 0..3 {
        seq = next_seq(seq);
        ts = next_ts_48k(ts);
    }
    assert_eq!((seq, ts), (3, 3 * 960));
    assert_eq!(next_seq(0xFFFF), 0);
    assert!(seq_is_newer(0xFFFF, next_seq(0xFFFF)));
}

#[test]
fn header_rejects_short_frames() {
    assert!(FrameHeader::parse(&[0u8; 7]).is_none());
    assert!(FrameHeader::parse(&[]).is_none());
}

#[test]
fn header_clamps_out_of_range_level_without_dropping_frame() {
    // 0x14 as i8 = +20, outside -127..=0, so it coerces to -127 (silence).
    let mut bytes = [0u8; V2_HEADER_LEN];
    bytes[6] = 0x14;
    let (parsed, _) = FrameHeader::parse(&bytes).expect("frame still delivered");
    assert_eq!(parsed.level_dbov, -127);
}

#[test]
fn header_ignores_reserved_flag_bits() {
    let header = FrameHeader {
        seq: 7,
        ts_48k: 7 * 960,
        level_dbov: -60,
        flags: FLAG_DTX | 0xFE,
    };
    let encoded = header.encode();
    let (parsed, _) = FrameHeader::parse(&encoded).expect("parses");
    assert!(parsed.is_dtx());
    assert_eq!(parsed.flags & FLAG_DTX, FLAG_DTX);
}

#[test]
fn dtx_flag_detected_only_on_bit_zero() {
    let plain = FrameHeader {
        seq: 1,
        ts_48k: 960,
        level_dbov: -40,
        flags: 0,
    };
    let dtx = FrameHeader {
        flags: FLAG_DTX,
        ..plain
    };
    assert!(!plain.is_dtx());
    assert!(dtx.is_dtx());
}

#[test]
fn sequence_ordering_fences_stale_and_duplicate_frames() {
    assert!(seq_is_newer(100, 101));
    assert!(!seq_is_newer(100, 100));
    assert!(!seq_is_newer(101, 100));
    // Wrapping: 0xFFFF + 1 == 0 is newer.
    assert!(seq_is_newer(0xFFFF, 0));
    assert!(!seq_is_newer(0, 0xFFFF));
}

#[test]
fn timestamp_delta_matches_960_per_20ms_frame() {
    assert_eq!(expected_ts_delta(0), 0);
    assert_eq!(expected_ts_delta(1), 960);
    assert_eq!(expected_ts_delta(50), 48_000);
}

#[test]
fn base64_bounds_accept_exact_length_and_reject_mismatch() {
    // 3 decoded bytes <-> 4 encoded chars.
    assert!(validate_bounded_base64_field(4, 3).is_ok());
    assert!(validate_bounded_base64_field(5, 3).is_err());
    assert!(validate_bounded_base64_field(0, 0).is_ok());
    assert!(validate_bounded_base64_field(4, 0).is_err());
    // One full 20 ms mono f32 frame = 960 * 4 = 3840 bytes -> 5120 chars.
    assert!(validate_bounded_base64_field(5120, 3840).is_ok());
    assert!(validate_bounded_base64_field(5119, 3840).is_err());
}

#[test]
fn base64_bounds_reject_over_cap_declarations() {
    assert!(validate_bounded_base64_field(4, MAX_BINARY_BYTES_PER_FRAME + 1).is_err());
}

#[test]
fn device_names_are_upstream_opaque_strings() {
    // audio_output.rs@origin/develop: any string is accepted, empty selects
    // the system default, and upstream imposes no content/length rules.
    // A prior revision of this contract invented path/length rejections;
    // they are removed here to match upstream exactly.
    assert!(validate_output_device_name("").is_ok());
    assert!(validate_output_device_name("MacBook Pro Speakers").is_ok());
    assert!(validate_output_device_name("a/b").is_ok());
    assert!(validate_output_device_name("..").is_ok());
    assert!(validate_output_device_name("name\nwith-newline").is_ok());
    assert!(validate_output_device_name(&"x".repeat(1024)).is_ok());
}

#[test]
fn pcm_batches_mirror_the_upstream_ipc_gate() {
    // mod.rs@origin/develop MAX_AUDIO_BATCH_BYTES = 100 KB; a nominal
    // 100 ms f32-LE batch is ~19 KB (4800 samples * 4 bytes).
    assert!(validate_pcm_batch_bytes(0).is_ok());
    assert!(validate_pcm_batch_bytes(19_200).is_ok());
    assert!(validate_pcm_batch_bytes(100 * 1024).is_ok());
    assert!(validate_pcm_batch_bytes(100 * 1024 + 1).is_err());
    // Encode-side rule (relay_api.rs): non-multiple-of-4 batches are
    // skipped, never rejected at the IPC boundary.
    assert!(pcm_batch_is_decodable(19_200));
    assert!(!pcm_batch_is_decodable(19_201));
}

#[test]
fn audio_base64_profile_caps_batches_below_transport_ceiling() {
    // Nominal 100 ms batch: 4800 f32 samples = 19200 bytes -> 25600 chars.
    assert!(validate_audio_batch_base64(25_600, 19_200).is_ok());
    // Full 100 KB batch: 102400 bytes = 3*34133+1 -> 34133*4+4 chars.
    assert!(validate_audio_batch_base64(136_536, 102_400).is_ok());
    assert!(validate_audio_batch_base64(136_535, 102_400).is_err());
    // Above the audio profile but below the 8 MiB transport ceiling:
    // rejected as audio, even though the transport could carry it.
    assert!(validate_audio_batch_base64(136_536, 102_401).is_err());
}

#[test]
fn cancellation_produces_one_terminal_outcome_and_discards_late_completion() {
    let mut state = AudioRequestState::Pending;
    assert_eq!(
        transition_audio_request(&mut state, AudioRequestEvent::Cancel),
        Ok(true)
    );
    assert_eq!(state, AudioRequestState::Cancelled);
    // A late completion after cancel is discarded, never resurrected.
    assert_eq!(
        transition_audio_request(&mut state, AudioRequestEvent::Complete),
        Ok(false)
    );
    assert_eq!(state, AudioRequestState::Cancelled);
}

#[test]
fn timeout_then_late_completion_is_discarded() {
    let mut state = AudioRequestState::Pending;
    assert_eq!(
        transition_audio_request(&mut state, AudioRequestEvent::Timeout),
        Ok(true)
    );
    assert_eq!(state, AudioRequestState::TimedOut);
    assert_eq!(
        transition_audio_request(&mut state, AudioRequestEvent::Complete),
        Ok(false)
    );
}

#[test]
fn generation_fence_drops_stale_frames() {
    assert!(generation_is_current(2, 2));
    assert!(!generation_is_current(2, 1));
    assert!(!generation_is_current(2, 3));
    assert!(!generation_is_current(0, 0));
}

#[test]
fn backpressure_trips_only_at_the_session_cap() {
    assert!(!audio_backpressure(0));
    assert!(!audio_backpressure(127));
    assert!(audio_backpressure(128));
    assert!(audio_backpressure(1024));
}

#[test]
fn pcm_frame_validator_pins_960_sample_contract() {
    assert!(validate_pcm_frame_samples(960).is_ok());
    assert!(validate_pcm_frame_samples(480).is_err());
    assert!(validate_pcm_frame_samples(0).is_err());
}
