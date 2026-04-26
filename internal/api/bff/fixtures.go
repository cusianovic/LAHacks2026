package bff

// =====================================================================
// Stub data used by the BFF until the real Pupload engine is wired in.
//
// Replace any of these with calls into `internal/models` /
// `internal/validation` / `internal/controller` once those exist.
// Search this file for `TODO(wire)` to find the swap points.
// =====================================================================

// SeedProject returns the demo project loaded on first request when
// no draft exists for the given ID.
//
// The first three tasks (encode, thumbnail, watermark) are faithful
// ports of the YAML in `examples/tasks/`. The remaining three
// (audio-extract, concat, image-resize) are authored in the same
// idiom — same publishers, same Docker images, same field shape — to
// give the AI generator and the step picker a richer palette to bind
// against.
func SeedProject(id string) Project {
	return Project{
		ID:           id,
		Tasks:        SeedTasks(),
		Flows:        []Flow{{Name: "default", Stores: []StoreInput{}, DataWells: []DataWell{}, Steps: []Step{}}},
		GlobalStores: []StoreInput{},
	}
}

// MergeSeedTasks returns a task list where every fixture-defined seed
// task is present (using the *seed's* current definition, so Exec /
// flag fixes in `SeedTasks` always reach the editor) and any draft
// tasks whose `Publisher/Name` doesn't match a seed entry are
// preserved at the end of the list (so user-added or AI-generated
// tasks survive across loads).
//
// Why this exists: the frontend autosaves the entire project — tasks
// included — back to the draft store on every edit. If the fixture
// list grows or a seed task gets fixed, the user's saved draft is
// already stale by the time the next reload happens, and a naive
// `LoadProject` would serve the stale list. Merging on read makes
// the seed list authoritative for fixture tasks while still letting
// the draft own everything else.
//
// Matching uses `Publisher + "/" + Name` as the unique key, mirroring
// the controller's `Step.Uses` resolution.
func MergeSeedTasks(draftTasks []Task) []Task {
	seed := SeedTasks()
	if len(draftTasks) == 0 {
		return seed
	}
	seedKeys := make(map[string]struct{}, len(seed))
	for _, t := range seed {
		seedKeys[t.Publisher+"/"+t.Name] = struct{}{}
	}
	out := make([]Task, 0, len(seed)+len(draftTasks))
	out = append(out, seed...)
	for _, t := range draftTasks {
		if _, isSeed := seedKeys[t.Publisher+"/"+t.Name]; isSeed {
			continue
		}
		out = append(out, t)
	}
	return out
}

// SeedTasks returns the canonical list of tasks the editor ships with.
// Exposed separately so the AI fixture and the seed share the same
// definitions.
func SeedTasks() []Task {
	return []Task{
		// ── examples/tasks/encode.yaml ────────────────────────────────
		{
			Publisher:   "pupload",
			Name:        "encode",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-small",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "VideoIn", Description: "Source video", Required: true, Type: []string{"video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "VideoOut", Description: "Transcoded video", Required: true, Type: []string{"video/mp4"}},
			},
			Flags: []TaskFlagDef{
				{Name: "codec", Description: "ffmpeg video codec, e.g. libx264 / libx265", Required: true, Type: "string", Default: "libx264"},
				{Name: "crf", Description: "Constant Rate Factor (quality, lower = better)", Required: true, Type: "int", Default: "23"},
				{Name: "resolution", Description: "Target height in pixels (width auto-scales)", Required: true, Type: "int", Default: "720"},
			},
			Command: TaskCommandDef{
				Name:        "encode",
				Description: "Transcode a video at the given codec, quality and resolution.",
				Exec:        "-i ${VideoIn} -c:v ${codec} -crf ${crf} -c:a aac -vf scale=-2:${resolution} -tag:v hvc1 ${VideoOut}",
			},
		},

		// ── examples/tasks/thumbnails.yaml ────────────────────────────
		{
			Publisher:   "pupload",
			Name:        "thumbnail",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-micro",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "VideoIn", Description: "Source video", Required: true, Type: []string{"video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "ThumbnailOut", Description: "Single-frame thumbnail", Required: true, Type: []string{"image/png"}},
			},
			Flags: []TaskFlagDef{
				{Name: "resolution", Description: "Thumbnail width in pixels", Required: true, Type: "int", Default: "320"},
			},
			Command: TaskCommandDef{
				Name:        "encode",
				Description: "Pick a representative frame and scale it to the given width.",
				Exec:        "-i ${VideoIn} -vf thumbnail,scale=${resolution}:-1 -frames:v 1 ${ThumbnailOut}",
			},
		},

		// ── examples/tasks/watermark_image.yaml ───────────────────────
		{
			Publisher:   "pupload",
			Name:        "watermark",
			Image:       "minidocks/imagemagick",
			Tier:        "c-small",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "ImageIn", Description: "Image to watermark", Required: true, Type: []string{"image/*"}},
				{Name: "WatermarkIn", Description: "Watermark image (typically a logo with alpha)", Required: true, Type: []string{"image/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "ImageOut", Description: "Watermarked image", Required: true, Type: []string{"image/png"}},
			},
			Flags: []TaskFlagDef{
				{Name: "watermark-width", Description: "Watermark width in pixels", Required: true, Type: "int", Default: "120"},
				{Name: "watermark-height", Description: "Watermark height in pixels (omit to preserve aspect)", Required: false, Type: "int"},
			},
			Command: TaskCommandDef{
				Name:        "watermark",
				Description: "Composite a watermark over the input image (south-east, +10/+10).",
				Exec:        "composite -gravity SouthEast -geometry +10+10 ( ${WatermarkIn} -resize ${watermark-width}x${watermark-height} ) ${ImageIn} ${ImageOut}",
			},
		},

		// ── new: extract an audio track from a video ──────────────────
		{
			Publisher:   "pupload",
			Name:        "audio-extract",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-micro",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "VideoIn", Description: "Source video", Required: true, Type: []string{"video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "AudioOut", Description: "Extracted audio track", Required: true, Type: []string{"audio/mpeg"}},
			},
			Flags: []TaskFlagDef{
				{Name: "bitrate", Description: "Audio bitrate, e.g. 128k / 192k", Required: true, Type: "string", Default: "192k"},
			},
			Command: TaskCommandDef{
				Name:        "extract",
				Description: "Strip the video stream and re-encode the audio as MP3.",
				Exec:        "-i ${VideoIn} -vn -c:a libmp3lame -b:a ${bitrate} ${AudioOut}",
			},
		},

		// ── new: concatenate two video clips ──────────────────────────
		// ffmpeg's `concat` *filter* (as opposed to the demuxer) is
		// strict: every input must share resolution, SAR, pixel format,
		// frame rate and audio sample rate, or the filtergraph fails
		// to configure ("Input link parameters do not match the
		// corresponding output link parameters"). Real uploads almost
		// never agree on all of these, so the Exec below normalises
		// each leg into a common canvas before feeding `concat`:
		//
		//   • scale  + pad → fit each leg into ${width}×${height}
		//                    letterboxed, preserving aspect ratio.
		//   • setsar=1     → drop any non-square pixel SAR (the
		//                    common cause of the "1280:1281" mismatch
		//                    we hit on encoder output).
		//   • fps=30       → enforce a uniform frame rate so the two
		//                    legs share `tbn`/`tbr` at the concat
		//                    boundary.
		//   • aresample +
		//     asetpts      → normalise audio sample rate and reset
		//                    timestamps so the second clip starts at
		//                    offset 0 in its own stream (concat
		//                    splices PTS itself).
		//
		// The whole filtergraph is one whitespace-free token so the
		// controller's argv tokeniser keeps it intact.
		{
			Publisher:   "pupload",
			Name:        "concat",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-small",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "FirstIn", Description: "First clip", Required: true, Type: []string{"video/*"}},
				{Name: "SecondIn", Description: "Second clip (appended to the first)", Required: true, Type: []string{"video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "VideoOut", Description: "Concatenated video", Required: true, Type: []string{"video/mp4"}},
			},
			Flags: []TaskFlagDef{
				{Name: "codec", Description: "ffmpeg video codec", Required: true, Type: "string", Default: "libx264"},
				{Name: "width", Description: "Output width in pixels (both clips letterboxed to this canvas)", Required: true, Type: "int", Default: "1280"},
				{Name: "height", Description: "Output height in pixels (both clips letterboxed to this canvas)", Required: true, Type: "int", Default: "720"},
			},
			Command: TaskCommandDef{
				Name:        "concat",
				Description: "Concatenate two clips end-to-end. Each clip is letterboxed into a common ${width}x${height} canvas and resampled so the concat filter accepts mismatched inputs.",
				Exec: "-i ${FirstIn} -i ${SecondIn} -filter_complex " +
					"[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease," +
					"pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v0];" +
					"[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease," +
					"pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v1];" +
					"[0:a]aresample=48000,asetpts=PTS-STARTPTS[a0];" +
					"[1:a]aresample=48000,asetpts=PTS-STARTPTS[a1];" +
					"[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a] " +
					"-map [v] -map [a] -c:v ${codec} ${VideoOut}",
			},
		},

		// ── new: resize a still image (imagemagick) ───────────────────
		{
			Publisher:   "pupload",
			Name:        "image-resize",
			Image:       "minidocks/imagemagick",
			Tier:        "c-micro",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "ImageIn", Description: "Source image", Required: true, Type: []string{"image/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "ImageOut", Description: "Resized image", Required: true, Type: []string{"image/*"}},
			},
			Flags: []TaskFlagDef{
				{Name: "width", Description: "Target width in pixels", Required: true, Type: "int", Default: "1024"},
				{Name: "height", Description: "Target height in pixels (omit to preserve aspect)", Required: false, Type: "int"},
			},
			Command: TaskCommandDef{
				Name:        "resize",
				Description: "Resize an image with ImageMagick, preserving aspect by default.",
				Exec:        "convert ${ImageIn} -resize ${width}x${height} ${ImageOut}",
			},
		},

		// ── new: cut a sub-clip between two timestamps ────────────────
		// `-ss` placed BEFORE `-i` does fast keyframe seek (input-side
		// seek), and `-c copy` makes this nearly instant since no
		// re-encode is performed. Frame-accurate trimming requires
		// `-ss` after `-i` plus a re-encode — set `codec` to
		// `libx264` (or any encoder) to switch into that mode.
		{
			Publisher:   "pupload",
			Name:        "trim",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-micro",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "VideoIn", Description: "Source video", Required: true, Type: []string{"video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "VideoOut", Description: "Trimmed clip", Required: true, Type: []string{"video/mp4"}},
			},
			Flags: []TaskFlagDef{
				{Name: "start", Description: "Start timestamp (HH:MM:SS or seconds)", Required: true, Type: "string", Default: "00:00:00"},
				{Name: "end", Description: "End timestamp (HH:MM:SS or seconds)", Required: true, Type: "string", Default: "00:00:10"},
				{Name: "codec", Description: "Video codec; `copy` skips re-encode (fast, keyframe-accurate)", Required: true, Type: "string", Default: "copy"},
			},
			Command: TaskCommandDef{
				Name:        "trim",
				Description: "Cut a sub-clip between two timestamps.",
				Exec:        "-ss ${start} -to ${end} -i ${VideoIn} -c ${codec} ${VideoOut}",
			},
		},

		// ── new: animated GIF preview from a video ────────────────────
		// Two-pass palette generation (palettegen → paletteuse) avoids
		// the muddy 256-colour artefacts of a naive single-pass GIF.
		// The whole pipeline lives in one filter_complex invocation so
		// no intermediate .png is needed; the filtergraph is
		// whitespace-free for the controller's argv tokeniser.
		{
			Publisher:   "pupload",
			Name:        "gif",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-small",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "VideoIn", Description: "Source video", Required: true, Type: []string{"video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "GifOut", Description: "Animated GIF preview", Required: true, Type: []string{"image/gif"}},
			},
			Flags: []TaskFlagDef{
				{Name: "start", Description: "Start timestamp (HH:MM:SS)", Required: true, Type: "string", Default: "00:00:00"},
				{Name: "duration", Description: "Clip length in seconds", Required: true, Type: "int", Default: "5"},
				{Name: "fps", Description: "GIF frame rate (8–15 is typical)", Required: true, Type: "int", Default: "12"},
				{Name: "width", Description: "GIF width in pixels (height auto-scales)", Required: true, Type: "int", Default: "480"},
			},
			Command: TaskCommandDef{
				Name:        "gif",
				Description: "Render a clip from the source as an animated GIF using two-pass palette generation.",
				Exec: "-ss ${start} -t ${duration} -i ${VideoIn} -filter_complex " +
					"[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];" +
					"[a]palettegen[p];[b][p]paletteuse[out] -map [out] ${GifOut}",
			},
		},

		// ── new: hard-burn subtitles into a video ─────────────────────
		// The `subtitles` filter rasterises the text onto each frame so
		// the video stream must be re-encoded; audio is stream-copied.
		{
			Publisher:   "pupload",
			Name:        "burn-subtitles",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-small",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "VideoIn", Description: "Source video", Required: true, Type: []string{"video/*"}},
				{Name: "SubtitleIn", Description: "Subtitle track (.srt or .vtt)", Required: true, Type: []string{"text/vtt", "application/x-subrip"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "VideoOut", Description: "Video with hard-burned captions", Required: true, Type: []string{"video/mp4"}},
			},
			Flags: []TaskFlagDef{
				{Name: "codec", Description: "Video codec for the re-encode", Required: true, Type: "string", Default: "libx264"},
			},
			Command: TaskCommandDef{
				Name:        "burn-subtitles",
				Description: "Hard-burn an SRT/VTT subtitle track into the video stream.",
				Exec:        "-i ${VideoIn} -vf subtitles=${SubtitleIn} -c:v ${codec} -c:a copy ${VideoOut}",
			},
		},

		// ── new: picture-in-picture composition ───────────────────────
		// Scales the overlay relative to its own width
		// (`scale=iw*${scale}:-1`) and places it at (${x}, ${y}) on the
		// background. ffmpeg expression variables `W`/`H` (canvas) and
		// `w`/`h` (overlay) are available, so the defaults pin the
		// overlay to the bottom-right with a 20px margin.
		{
			Publisher:   "pupload",
			Name:        "picture-in-picture",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-medium",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "BackgroundIn", Description: "Main background video (e.g. screencast)", Required: true, Type: []string{"video/*"}},
				{Name: "OverlayIn", Description: "Overlay video (e.g. talking head)", Required: true, Type: []string{"video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "VideoOut", Description: "Composited video", Required: true, Type: []string{"video/mp4"}},
			},
			Flags: []TaskFlagDef{
				{Name: "x", Description: "Overlay X position (ffmpeg expression; default = bottom-right with 20px margin)", Required: true, Type: "string", Default: "W-w-20"},
				{Name: "y", Description: "Overlay Y position (ffmpeg expression)", Required: true, Type: "string", Default: "H-h-20"},
				{Name: "scale", Description: "Overlay width as a fraction of its native size (0.25 = quarter-size)", Required: true, Type: "string", Default: "0.25"},
				{Name: "codec", Description: "Output video codec", Required: true, Type: "string", Default: "libx264"},
			},
			Command: TaskCommandDef{
				Name:        "picture-in-picture",
				Description: "Composite an overlay clip onto a background video at the specified position.",
				Exec:        "-i ${BackgroundIn} -i ${OverlayIn} -filter_complex [1:v]scale=iw*${scale}:-1[ovr];[0:v][ovr]overlay=${x}:${y} -c:v ${codec} ${VideoOut}",
			},
		},

		// ── new: EBU R128 loudness normalisation ──────────────────────
		// The `loudnorm` filter resamples + gain-compensates the audio
		// to hit `${target_lufs}` integrated loudness. Video is
		// stream-copied (`-c:v copy`) by default since this task
		// touches only audio.
		{
			Publisher:   "pupload",
			Name:        "loudness-normalize",
			Image:       "linuxserver/ffmpeg",
			Tier:        "c-small",
			MaxAttempts: 3,
			Inputs: []TaskEdgeDef{
				{Name: "VideoIn", Description: "Source video (audio is normalised; video is copied)", Required: true, Type: []string{"video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "VideoOut", Description: "Loudness-normalised video", Required: true, Type: []string{"video/mp4"}},
			},
			Flags: []TaskFlagDef{
				{Name: "target_lufs", Description: "Integrated loudness target in LUFS (-16 streaming, -14 YouTube, -23 EBU broadcast)", Required: true, Type: "string", Default: "-16"},
				{Name: "codec", Description: "Video codec; default `copy` keeps the picture untouched", Required: true, Type: "string", Default: "copy"},
			},
			Command: TaskCommandDef{
				Name:        "loudness-normalize",
				Description: "Apply EBU R128 loudness normalisation to the audio track. Video is stream-copied by default.",
				Exec:        "-i ${VideoIn} -af loudnorm=I=${target_lufs}:TP=-1.5:LRA=11 -c:v ${codec} -c:a aac ${VideoOut}",
			},
		},

		// ── new: GPU-accelerated speech-to-text via OpenAI Whisper ────
		// Demonstrates the GPU-tier pattern: any task tagged `gn-*`
		// is scheduled by the controller onto an NVIDIA-capable
		// worker (see 04-controller-api-reference.md § Valid Tiers),
		// which then runs the container with `--gpus all` so the
		// image can use CUDA without further configuration.
		//
		// The image is intentionally a custom namespace
		// (`pupload/whisper:gpu`) — Whisper ships as a Python
		// package, not as a public Docker entrypoint, so a thin
		// wrapper image is the cleanest fit. A minimal Dockerfile:
		//
		//   FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime
		//   RUN pip install --no-cache-dir openai-whisper
		//   COPY entrypoint.sh /usr/local/bin/transcribe
		//   ENTRYPOINT ["transcribe"]
		//
		// Where `entrypoint.sh` reads `$1` as the input audio path,
		// `$2` as the destination VTT path, and forwards the rest of
		// the args to `whisper`. That contract matches the Exec
		// template below — any image honouring the same arg shape
		// (e.g. a faster-whisper or whisper.cpp wrapper) drops in
		// without flow changes.
		{
			Publisher:   "pupload",
			Name:        "transcribe",
			Image:       "pupload/whisper:gpu",
			Tier:        "gn-small",
			MaxAttempts: 2,
			Inputs: []TaskEdgeDef{
				{Name: "AudioIn", Description: "Source audio or video; Whisper extracts audio internally", Required: true, Type: []string{"audio/*", "video/*"}},
			},
			Outputs: []TaskEdgeDef{
				{Name: "TranscriptOut", Description: "Transcript in WebVTT format (cue-aligned with audio)", Required: true, Type: []string{"text/vtt"}},
			},
			Flags: []TaskFlagDef{
				{Name: "model", Description: "Whisper model size: tiny / base / small / medium / large-v3 (larger = slower + more accurate)", Required: true, Type: "string", Default: "base"},
				{Name: "language", Description: "ISO 639-1 language code, or `auto` to let Whisper detect", Required: true, Type: "string", Default: "auto"},
			},
			Command: TaskCommandDef{
				Name:        "transcribe",
				Description: "GPU-accelerated speech-to-text via OpenAI Whisper. Outputs WebVTT cues aligned with the audio.",
				Exec:        "${AudioIn} ${TranscriptOut} --model ${model} --language ${language}",
			},
		},
	}
}

// SampleAIFlow is what `/bff/ai/generate` returns until a real Claude
// integration replaces it. The shape mirrors what a real generation
// would produce: a Flow, an auto-laid-out CanvasLayout, optional new
// task definitions, and any warnings.
//
// The flow is a port of `examples/flows/adaptive-video.yaml` — one
// upload edge fans out to three encode steps at 1080/720/480 plus a
// thumbnail step. It exercises the same task palette the editor seeds
// with, so the AI button produces something that runs end-to-end.
//
// TODO(wire): swap this for a Claude API call on the Go side.
func SampleAIFlow(_ string) AIGenerateResult {
	flow := Flow{
		Name:    "adaptive-video",
		Timeout: "10m",
		Stores: []StoreInput{
			// Mirrors `examples/flows/adaptive-video.yaml`: a single
			// `test-store` of type `s3`. Params are intentionally
			// blank so the operator fills in their own MinIO/S3
			// creds via the store inspector. Keys must use the
			// PascalCase shape from MD 4 § StoreInput when populated.
			{Name: "test-store", Type: "s3", Params: map[string]any{}},
		},
		// Falls through for any datawell that doesn't pin a store —
		// matches the `DefaultDataWell` block in the example flow.
		DefaultDataWell: &DataWell{Store: "test-store"},
		DataWells: []DataWell{
			{Edge: "video-in", Store: "test-store", Source: "upload", Key: "${RUN_ID}/source"},
			{Edge: "video-1080", Store: "test-store", Source: "static", Key: "${RUN_ID}/1080.mp4"},
			{Edge: "video-720", Store: "test-store", Source: "static", Key: "${RUN_ID}/720.mp4"},
			{Edge: "video-480", Store: "test-store", Source: "static", Key: "${RUN_ID}/480.mp4"},
			{Edge: "thumbnail", Store: "test-store", Source: "static", Key: "${RUN_ID}/thumb.png"},
		},
		Steps: []Step{
			encodeStep("encode-1080p", "video-in", "video-1080", "libx265", "28", "1080"),
			encodeStep("encode-720p", "video-in", "video-720", "libx265", "28", "720"),
			encodeStep("encode-480p", "video-in", "video-480", "libx265", "28", "480"),
			{
				ID:      "thumbnail-node",
				Uses:    "pupload/thumbnail",
				Inputs:  []StepEdge{{Name: "VideoIn", Edge: "video-in"}},
				Outputs: []StepEdge{{Name: "ThumbnailOut", Edge: "thumbnail"}},
				Flags:   []StepFlag{{Name: "resolution", Value: "320"}},
				Command: "encode",
			},
		},
	}

	// Stack the four steps vertically with the upload well on the left
	// and the per-rendition wells on the right. Same shape as the
	// canvas's auto-layout but precomputed so the user gets a tidy
	// graph the moment the AI dialog closes.
	layout := CanvasLayout{
		FlowName: flow.Name,
		Zoom:     1,
		Offset:   XY{X: 0, Y: 0},
		NodePositions: map[string]XY{
			"encode-1080p":   {X: 360, Y: 80},
			"encode-720p":    {X: 360, Y: 240},
			"encode-480p":    {X: 360, Y: 400},
			"thumbnail-node": {X: 360, Y: 560},
		},
		DataWellPositions: map[string]XY{
			"video-in":   {X: 40, Y: 320},
			"video-1080": {X: 720, Y: 80},
			"video-720":  {X: 720, Y: 240},
			"video-480":  {X: 720, Y: 400},
			"thumbnail":  {X: 720, Y: 560},
		},
	}

	return AIGenerateResult{
		Flow:     flow,
		Layout:   layout,
		NewTasks: []Task{},
		Warnings: []string{
			"Stub response — wire to Claude in internal/api/bff/handler.go.",
		},
	}
}

// encodeStep is a small helper for the AI fixture so the four near-
// identical encode steps stay readable. Parameters mirror the
// `pupload/encode` task's flag set.
func encodeStep(id, inEdge, outEdge, codec, crf, resolution string) Step {
	return Step{
		ID:      id,
		Uses:    "pupload/encode",
		Inputs:  []StepEdge{{Name: "VideoIn", Edge: inEdge}},
		Outputs: []StepEdge{{Name: "VideoOut", Edge: outEdge}},
		Flags: []StepFlag{
			{Name: "codec", Value: codec},
			{Name: "crf", Value: crf},
			{Name: "resolution", Value: resolution},
		},
		Command: "encode",
	}
}
