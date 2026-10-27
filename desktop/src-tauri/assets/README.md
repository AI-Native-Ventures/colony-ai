# Host assets

`voice-note-video-frame.mp4` is one black 16x16 H.264 frame lasting 0.1 s. The
voice-note upload repeats it for the length of the recording to build the video
track the relay requires, using stream copy, so a voice note needs no H.264
encoder. SEI and metadata are stripped.

```sh
ffmpeg -f lavfi -i "color=c=black:s=16x16:r=10" -frames:v 1 \
  -c:v libx264 -preset ultrafast -tune stillimage -pix_fmt yuv420p \
  -bsf:v filter_units=remove_types=6 -fflags +bitexact -flags:v +bitexact \
  -map_metadata -1 -movflags +faststart voice-note-video-frame.mp4
```
