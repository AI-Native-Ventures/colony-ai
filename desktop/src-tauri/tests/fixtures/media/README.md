# Media fixtures for the host's transcode tests

Small files the tests in `src/commands/media_transcode.rs` run through ffmpeg.
They exist so the tests do not depend on ffmpeg being able to generate input
(the ffmpeg bundled in the app has no test-pattern source and no libx264).

| File | What it is | How it was made |
|---|---|---|
| `sample-h264.mp4` | 640x360, 2 s, H.264 + AAC | `ffmpeg -f lavfi -i testsrc2=s=640x360:r=24:d=2 -f lavfi -i sine=frequency=440:d=2 -c:v libx264 -preset slow -crf 32 -pix_fmt yuv420p -c:a aac -b:a 48k -shortest -map_metadata -1 -movflags +faststart` |
| `sample-hevc.mov` | 480x270, 1 s, HEVC + AAC in a MOV, like an iPhone clip | `ffmpeg -f lavfi -i testsrc2=s=480x270:r=24:d=1 -f lavfi -i sine=frequency=330:d=1 -c:v libx265 -preset slow -crf 34 -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 48k -shortest -map_metadata -1 -f mov` |
| `sample-with-location.mp4` | 64x64, 1 s, carries a GPS location (`loci` box) and a stream title the transcode must drop | `ffmpeg -f lavfi -i testsrc2=size=64x64:rate=1 -t 1 -c:v libx264 -metadata "location=+37.7-122.4/" -metadata:s:v:0 "title=private camera stream"` |
| `sample.heic` | 320x240 single-image HEIC | `sips -s format heic -s formatOptions 30` on a 320x240 PNG (macOS) |

All were made with ffmpeg 8.1 (Homebrew) on Apple silicon.
