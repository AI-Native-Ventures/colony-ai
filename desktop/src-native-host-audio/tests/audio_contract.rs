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
    audio_backpressure, expected_ts_delta, generation_is_current, seq_is_newer,
    transition_audio_request, validate_bounded_base64_field, validate_output_device_name,
    validate_pcm_frame_samples, AudioRequestEvent, AudioRequestState, FrameHeader, CHANNELS,
    FLAG_DTX, FRAME_SAMPLES_20MS, FRAME_TIMESTAMP_DELTA, MAX_BINARY_BYTES_PER_FRAME,
    PCM_QUEUE_DEPTH, PLAYOUT_SAMPLES_10MS, PLAYOUT_TICK_MS, PROTOCOL_VERSION, SAMPLE_RATE_HZ,
    V2_HEADER_LEN,
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
    let (parsed, _) = FrameHeader::parse(&header.encode()).expect("parses");
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
fn device_names_accept_default_and_reject_path_smuggling() {
    assert!(validate_output_device_name("").is_ok());
    assert!(validate_output_device_name("MacBook Pro Speakers").is_ok());
    assert!(validate_output_device_name("a/b").is_err());
    assert!(validate_output_device_name("..").is_err());
    assert!(validate_output_device_name("name\nwith-newline").is_err());
    assert!(validate_output_device_name(&"x".repeat(257)).is_err());
    assert!(validate_output_device_name(&"x".repeat(256)).is_ok());
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
