# Desktop voice-note envelope fixture

`voice-note-envelope.mp4` is what the desktop uploads for a voice note.

The renderer records `audio/webm;codecs=opus` with `MediaRecorder`, decodes it
with `decodeAudioData`, and writes a 24 kHz mono 16-bit WAV
(`desktop/src/features/messages/lib/voiceNoteWav.ts`). The native host then
packages the WAV in the relay's video envelope
(`transcode_voice_note_to_mp4_with_cancellation` in
`desktop/src-tauri/src/commands/media_transcode.rs`): a 16x16 black H.264 track
plus the AAC audio. The relay never sees the WebM or the WAV.

## Regeneration

```sh
say -o speech.aiff "Finding clients. We tried ads and spent about sixty rand."
ffmpeg -i speech.aiff -c:a libopus -b:a 32k -f webm speech.webm
ffmpeg -i speech.webm -ac 1 -ar 24000 -c:a pcm_s16le voice-note-1.wav
ffmpeg -y -nostdin -loglevel error -f lavfi -i "color=c=black:s=16x16:r=1" \
  -i voice-note-1.wav -map 0:v:0 -map 1:a:0 -shortest -map_metadata -1 \
  -map_chapters -1 -sn -dn -fflags +bitexact -flags:v +bitexact \
  -flags:a +bitexact -c:v libx264 -preset ultrafast -tune stillimage \
  -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart -metadata encoder= \
  voice-note-envelope.mp4
```

Generated with ffmpeg 8.1 (Homebrew, arm64).
