package bff

// =====================================================================
// Stub data used by the BFF until the real Pupload engine is wired in.
//
// Replace any of these with calls into `internal/models` /
// `internal/validation` / `internal/controller` once those exist.
// Search this file for `TODO(wire)` to find the swap points.
// =====================================================================

// SeedProject returns the demo project loaded on first request when
// no draft exists for the given ID. Two example tasks (ffmpeg + s3-put)
// give the AI generator + step picker something real to bind against.
func SeedProject(id string) Project {
	return Project{
		ID: id,
		Tasks: []Task{
			{
				Publisher:   "pupload",
				Name:        "ffmpeg",
				Image:       "pupload/ffmpeg:latest",
				Tier:        "c-small",
				MaxAttempts: 3,
				Inputs: []TaskEdgeDef{
					{Name: "in", Description: "Input video", Required: true, Type: []string{"video/*"}},
				},
				Outputs: []TaskEdgeDef{
					{Name: "out", Description: "Transcoded output", Required: true, Type: []string{"video/mp4"}},
				},
				Flags: []TaskFlagDef{
					{Name: "scale", Description: "Output scale, e.g. 1280:720", Required: true, Type: "string", Default: "1280:720"},
					{Name: "crf", Description: "Constant Rate Factor (quality)", Required: false, Type: "int", Default: "23"},
				},
				Command: TaskCommandDef{
					Name:        "transcode",
					Description: "Run ffmpeg with the given scale.",
					Exec:        "ffmpeg -i ${input.in} -vf scale=${flag.scale} -crf ${flag.crf} ${output.out}",
				},
			},
			{
				Publisher:   "pupload",
				Name:        "s3-put",
				Image:       "pupload/s3-put:latest",
				Tier:        "c-tiny",
				MaxAttempts: 5,
				Inputs: []TaskEdgeDef{
					{Name: "object", Description: "Object to upload", Required: true, Type: []string{"*/*"}},
				},
				Outputs: []TaskEdgeDef{
					{Name: "location", Description: "Resulting S3 URL", Required: true, Type: []string{"text/plain"}},
				},
				Flags: []TaskFlagDef{
					{Name: "acl", Description: "S3 ACL", Required: false, Type: "string", Default: "private"},
				},
				Command: TaskCommandDef{
					Name:        "put",
					Description: "Put object to S3.",
					Exec:        "s3-put --acl ${flag.acl} ${input.object} > ${output.location}",
				},
			},
			{
				Publisher:   "pupload",
				Name:        "image-resize",
				Image:       "pupload/image-resize:latest",
				Tier:        "c-small",
				MaxAttempts: 3,
				Inputs: []TaskEdgeDef{
					{Name: "src", Description: "Source image", Required: true, Type: []string{"image/*"}},
				},
				Outputs: []TaskEdgeDef{
					{Name: "out", Description: "Resized image", Required: true, Type: []string{"image/*"}},
				},
				Flags: []TaskFlagDef{
					{Name: "width", Description: "Target width", Required: true, Type: "int", Default: "1024"},
				},
				Command: TaskCommandDef{
					Name:        "resize",
					Description: "Resize image to target width preserving aspect.",
					Exec:        "image-resize --width ${flag.width} ${input.src} ${output.out}",
				},
			},
		},
		Flows: []Flow{
			{
				Name:      "default",
				Stores:    []StoreInput{},
				DataWells: []DataWell{},
				Steps:     []Step{},
			},
		},
		GlobalStores: []StoreInput{},
	}
}

// SampleAIFlow is what `/bff/ai/generate` returns until a real Claude
// integration replaces it. The shape mirrors what a real generation
// would produce: a Flow, an auto-laid-out CanvasLayout, optional new
// task definitions, and any warnings.
//
// TODO(wire): swap this for a Claude API call on the Go side.
func SampleAIFlow(_ string) AIGenerateResult {
	flow := Flow{
		Name:    "ai-generated",
		Timeout: "10m",
		Stores: []StoreInput{
			{Name: "primary", Type: "s3", Params: map[string]any{
				"endpoint": "https://s3.amazonaws.com",
				"bucket":   "pupload-demo",
			}},
		},
		DataWells: []DataWell{
			{Edge: "upload", Store: "primary", Source: "upload", Key: "${RUN_ID}/source"},
			{Edge: "thumb_out", Store: "primary", Source: "static", Key: "${RUN_ID}/thumb.jpg"},
			{Edge: "hd_out", Store: "primary", Source: "static", Key: "${RUN_ID}/hd.jpg"},
		},
		Steps: []Step{
			{
				ID:   "thumb",
				Uses: "pupload/image-resize",
				Inputs:  []StepEdge{{Name: "src", Edge: "upload"}},
				Outputs: []StepEdge{{Name: "out", Edge: "thumb_edge"}},
				Flags:   []StepFlag{{Name: "width", Value: "256"}},
				Command: "resize",
			},
			{
				ID:   "hd",
				Uses: "pupload/image-resize",
				Inputs:  []StepEdge{{Name: "src", Edge: "upload"}},
				Outputs: []StepEdge{{Name: "out", Edge: "hd_edge"}},
				Flags:   []StepFlag{{Name: "width", Value: "1920"}},
				Command: "resize",
			},
			{
				ID:   "put_thumb",
				Uses: "pupload/s3-put",
				Inputs:  []StepEdge{{Name: "object", Edge: "thumb_edge"}},
				Outputs: []StepEdge{{Name: "location", Edge: "thumb_out"}},
				Flags:   []StepFlag{{Name: "acl", Value: "public-read"}},
				Command: "put",
			},
			{
				ID:   "put_hd",
				Uses: "pupload/s3-put",
				Inputs:  []StepEdge{{Name: "object", Edge: "hd_edge"}},
				Outputs: []StepEdge{{Name: "location", Edge: "hd_out"}},
				Flags:   []StepFlag{{Name: "acl", Value: "private"}},
				Command: "put",
			},
		},
	}

	layout := CanvasLayout{
		FlowName: flow.Name,
		Zoom:     1,
		Offset:   XY{X: 0, Y: 0},
		NodePositions: map[string]XY{
			"thumb":     {X: 320, Y: 120},
			"hd":        {X: 320, Y: 280},
			"put_thumb": {X: 600, Y: 120},
			"put_hd":    {X: 600, Y: 280},
		},
		DataWellPositions: map[string]XY{
			"upload":    {X: 60, Y: 200},
			"thumb_out": {X: 880, Y: 120},
			"hd_out":    {X: 880, Y: 280},
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
