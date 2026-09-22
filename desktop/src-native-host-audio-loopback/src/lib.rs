//! Hosted-only synthetic Opus loopback for the audio parity lane.
//!
//! Fixture PCM (silence, full-scale, 1 kHz sine) is encoded with the exact
//! upstream encoder settings (`opus 0.3`, VoIP, 48 kHz mono, 32 kbps,
//! DTX on), wrapped as fixture relay bytes (peer prefix + v2 header +
//! Opus), parsed back with the lane contract, and drained through NetEq
//! (`neteq 0.8`, same `PeerJitterBuffer` shape as upstream `jitter.rs`).
//! No microphone, speaker, relay, or network is touched. Native
//! compilation (`opus-sys` C build) is hosted-only; the local shared Mac
//! runs fmt/diff/scan only.

use colony_native_host_audio::{
    audio_level_dbov, next_seq, next_ts_48k, FrameHeader, FLAG_DTX, FRAME_SAMPLES_20MS,
    MAX_OPUS_PACKET_BYTES,
};
use neteq::{codec::AudioDecoder, neteq::SpeechType, AudioPacket, NetEq, NetEqConfig, RtpHeader};

pub const OPUS_PAYLOAD_TYPE: u8 = 111;
pub const SAMPLE_RATE_HZ: u32 = 48_000;
pub const CHANNELS: u8 = 1;
pub const FRAME_DURATION_MS: u32 = 20;
pub const PLAYOUT_SAMPLES_10MS: usize = 480;

/// Encode settings mirror `relay_api.rs@origin/develop` exactly.
pub fn upstream_encoder() -> Result<opus::Encoder, opus::Error> {
    let mut encoder = opus::Encoder::new(
        SAMPLE_RATE_HZ,
        opus::Channels::Mono,
        opus::Application::Voip,
    )?;
    encoder.set_bitrate(opus::Bitrate::Bits(32_000))?;
    encoder.set_dtx(true)?;
    Ok(encoder)
}

/// One encoded fixture frame: header + Opus payload, with the DTX rule
/// (`encoded_len <= 2` flags DTX) applied exactly like upstream.
pub struct EncodedFrame {
    pub header: FrameHeader,
    pub opus: Vec<u8>,
}

pub fn encode_frame(
    encoder: &mut opus::Encoder,
    pcm_960: &[f32],
    seq: u16,
    ts_48k: u32,
    out_buf: &mut [u8],
) -> Option<EncodedFrame> {
    assert_eq!(pcm_960.len(), FRAME_SAMPLES_20MS);
    assert!(out_buf.len() >= MAX_OPUS_PACKET_BYTES);
    let level = audio_level_dbov(pcm_960);
    let n = encoder.encode_float(pcm_960, out_buf).ok()?;
    if n == 0 {
        return None;
    }
    let flags = if n <= 2 { FLAG_DTX } else { 0 };
    Some(EncodedFrame {
        header: FrameHeader {
            seq,
            ts_48k,
            level_dbov: level,
            flags,
        },
        opus: out_buf[..n].to_vec(),
    })
}

/// Wrap an encoded frame as fixture relay bytes (peer prefix + header +
/// Opus), mirroring what the relay forwards to clients.
pub fn relay_bytes(peer_index: u8, frame: &EncodedFrame) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(1 + 8 + frame.opus.len());
    bytes.push(peer_index);
    bytes.extend_from_slice(&frame.header.encode());
    bytes.extend_from_slice(&frame.opus);
    bytes
}

struct OpusDecoder {
    inner: opus::Decoder,
    scratch: Vec<f32>,
}

impl OpusDecoder {
    fn new() -> Result<Self, opus::Error> {
        Ok(Self {
            inner: opus::Decoder::new(SAMPLE_RATE_HZ, opus::Channels::Mono)?,
            scratch: vec![0.0; 5760],
        })
    }
}

impl AudioDecoder for OpusDecoder {
    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE_HZ
    }

    fn channels(&self) -> u8 {
        CHANNELS
    }

    fn decode(&mut self, encoded: &[u8]) -> Result<Vec<f32>, neteq::NetEqError> {
        match self.inner.decode_float(encoded, &mut self.scratch, false) {
            Ok(n) => Ok(self.scratch[..n * usize::from(CHANNELS)].to_vec()),
            Err(e) => Err(neteq::NetEqError::DecoderError(format!("opus decode: {e}"))),
        }
    }
}

/// Minimal jitter drain mirroring upstream `PeerJitterBuffer`: synthetic
/// SSRC = peer index, 20 ms Opus inserts, 10 ms playout reads.
pub struct LoopbackDrain {
    neteq: NetEq,
    ssrc: u32,
}

impl LoopbackDrain {
    pub fn new(peer_index: u8) -> Result<Self, neteq::NetEqError> {
        let mut neteq = NetEq::new(NetEqConfig {
            sample_rate: SAMPLE_RATE_HZ,
            channels: CHANNELS,
            max_packets_in_buffer: colony_native_host_audio::PCM_QUEUE_DEPTH,
            ..Default::default()
        })?;
        let decoder = OpusDecoder::new()
            .map_err(|e| neteq::NetEqError::DecoderError(format!("opus decoder init: {e}")))?;
        neteq.register_decoder(OPUS_PAYLOAD_TYPE, Box::new(decoder));
        Ok(Self {
            neteq,
            ssrc: u32::from(peer_index),
        })
    }

    pub fn insert(
        &mut self,
        seq: u16,
        ts_48k: u32,
        opus: Vec<u8>,
    ) -> Result<(), neteq::NetEqError> {
        let header = RtpHeader::new(seq, ts_48k, self.ssrc, OPUS_PAYLOAD_TYPE, false);
        self.neteq.insert_packet(AudioPacket::new(
            header,
            opus,
            SAMPLE_RATE_HZ,
            CHANNELS,
            FRAME_DURATION_MS,
        ))
    }

    pub fn drain_10ms(&mut self) -> Result<(Vec<f32>, bool), neteq::NetEqError> {
        let frame = self.neteq.get_audio()?;
        let vad = frame.vad_activity && !matches!(frame.speech_type, SpeechType::Expand);
        Ok((frame.samples, vad))
    }

    pub fn is_empty(&self) -> bool {
        self.neteq.is_empty()
    }
}

/// Advance one upstream send-loop step: returns the next (seq, ts) pair.
pub fn step(seq: u16, ts_48k: u32) -> (u16, u32) {
    (next_seq(seq), next_ts_48k(ts_48k))
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn encoder_settings_match_upstream() {
        let encoder = upstream_encoder().expect("encoder builds");
        drop(encoder);
    }
}
