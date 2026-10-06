# Alto Video Factory

Internal Alto Pro tool that turns **one real project photo** into a polished construction-progress video, with a person approving every step:

```
upload → scene constraints → work-area mask → stage plan
       → for each stage: prompt ✓ → candidate images (side by side) → AI review → image ✓
       → (all stages approved) → one transition clip per adjacent pair → AI review → clip ✓
       → assemble + Alto branding → MP4
```

Nothing is auto-chained: stage *n* is always generated from the **approved** image of stage *n-1*. Clips can only be animated after every stage image is approved, and a single clip can be retried without touching the others.

MVP trade: **concrete driveway** (prepared base → forms and rebar → concrete placement → finished driveway).

## Quick start

```bash
npm install
cp .env.example .env   # optional: every key is optional
npm run dev            # API on :8787, UI on http://localhost:5174
npm test               # gate unit tests + full end-to-end workflow through the API
```

With no API keys, every provider slot uses a clearly labelled **fake**: tinted masks for images, cross-fades for clips, placeholder reviews. The whole workflow (jobs, storage, gates, UI, final render) runs offline that way. Add keys to get real output. Fakes are listed in the sidebar and show `(fake)` in every label.

`node scripts/ui-walkthrough.mjs photo.jpg shots/` drives the running app through the whole flow in headless Chromium and saves screenshots. `npx tsx scripts/make-sample-photo.ts` writes a synthetic test photo.

## Architecture

| Concern | Implementation | Swap via |
|---|---|---|
| UI | Vite + React SPA (`src/client`) | |
| API | Hono on Node (`src/server/app.ts`) | |
| Workflow rules | Pure gate functions shared by server and UI (`src/shared/gates.ts`) | |
| Records | Supabase (`SupabaseStore`) or a local JSON file (`FileStore`) | `SUPABASE_URL` |
| Media | Cloudflare R2 (S3 API, write-once, signed URLs) or local disk | `R2_*` |
| Jobs | Inngest (durable steps, retries, `step.sleep` polling) or in-process runner | `INNGEST_ENABLED` |
| Render | FFmpeg; optional Remotion intro/outro cards | `RENDER_ENGINE` |

### Providers (all behind adapters in `src/server/providers`)

| Slot | Default | Model ID env |
|---|---|---|
| Scene analysis, plan, prompt writing, image and clip review | OpenAI Responses API with strict JSON schemas | `OPENAI_VISION_MODEL` (default `gpt-5.5`) |
| Stage images (primary) | Gemini Nano Banana Pro | `GEMINI_IMAGE_MODEL` (default `gemini-3-pro-image-preview`) |
| Stage images (parallel candidate) | OpenAI GPT Image edits with mask | `OPENAI_IMAGE_MODEL` (default `gpt-image-2.5-sunburst`) |
| Transitions (primary) | Veo 3.1 with `image` + `config.lastFrame` | `VEO_MODEL` (default `veo-3.1-generate-preview`) |
| Transitions (challengers) | Kling 3.0 Pro, Seedance 2.5 on fal | `FAL_KLING_ENDPOINT`, `FAL_SEEDANCE_ENDPOINT` |
| Work-area mask | SAM 2 on fal (box + point prompt from scene analysis), plus a manual brush editor | `FAL_SAM2_ENDPOINT` |

To add or compare a model, implement `ImageGenerator` / `VideoGenerator` / `Segmenter` / `Analyst` (`providers/types.ts`) and register it in `providers/registry.ts`. The workflow never names a concrete provider.

## How the approval rules are enforced

- **Every mutating endpoint** checks a gate from `src/shared/gates.ts` and returns `409` with a reason if the step is out of order. The UI renders the same gate results, so locked buttons explain themselves.
- **Every job re-checks** its gate before writing results. A generation that finishes after the user reopened a step is discarded, not applied.
- **Chaining:** each candidate records the `baseAssetId` it was edited from and the prompt it used. A candidate can only be approved if its base is the *current* approved image of the previous stage and its prompt is the current approved prompt.
- **Reopening** (scene, mask, plan, a stage or a clip) is explicit and cascades: it clears every downstream approval and the prepared clips, and asks for confirmation first.
- **Original photo:** stored byte-for-byte as an immutable asset. A separate normalized copy (EXIF orientation applied, sRGB, JPEG/PNG; never resized or edited) is used for processing. If the upload is already upright JPEG/PNG, the normalized copy is the same bytes.
- **Database guards** (`supabase/migrations`): ordered approvals on `vf_projects`, "image approval requires prompt approval" on `vf_stages`, and a trigger that makes `vf_assets` rows immutable. Media keys are write-once in both storage backends.

## Media pipeline details

- Stage images are resized to the exact pixel size of the normalized photo, so every frame stays aligned.
- Gemini has no mask parameter: the mask goes in as a labelled reference image. OpenAI gets a proper RGBA edit mask.
- Before animation, both frames are center-cropped to the project's video aspect (`16:9` or `9:16`, Veo's supported ratios). The same crop is used for every provider so takes are comparable.
- Each clip is sampled at N evenly spaced frames (`CLIP_REVIEW_FRAMES`), and the reviewer compares them with the approved first and last frames.
- Final assembly normalizes every clip to one size, fps and codec, overlays the watermark, holds the last frame, adds intro/outro cards and concatenates. Audio is dropped because providers differ on whether they return any.

## Deploying

1. **Supabase:** run `supabase/migrations/*.sql`, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server only).
2. **R2:** create a bucket and an API token, then set `R2_*`. For the mask editor to read existing masks back into a canvas, the bucket needs a CORS rule allowing `GET` from the app origin (or set `R2_PUBLIC_BASE_URL` on a domain with CORS).
3. **Inngest:** set `INNGEST_ENABLED=true` plus `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`, and register `https://<host>/api/inngest` as the app URL. Locally: `npx inngest-cli dev` with `INNGEST_DEV=1`.
4. `npm run build && npm start` serves the API and the built UI from one Node process. Set `FAKE_MISSING_PROVIDERS=false` so a missing key fails loudly instead of silently using a fake.
5. **Remotion (optional):** `RENDER_ENGINE=remotion` and `REMOTION_BROWSER_EXECUTABLE` pointing at a Chrome headless shell. Otherwise Remotion downloads one from `remotion.media` on first render.

## Verified vs. not yet verified

Verified in this repo, with fake providers:
- The full workflow end to end through the HTTP API, including every out-of-order action being refused (`tests/workflow.test.ts`).
- The full workflow through the real UI in headless Chromium (`scripts/ui-walkthrough.mjs`).
- Both render engines (FFmpeg and Remotion).

**Not yet run against live provider APIs.** The build environment's network policy blocked them. Request shapes come from the official SDK type definitions (`@google/genai`, `openai`, `@fal-ai/client`), but these points need a first live check:

- `gemini-3-pro-image-preview` vs. `gemini-3-pro-image`: use whichever ID your key lists.
- Veo 3.1 `lastFrame` on the Gemini API: early previews rejected it, so confirm with a first real run. Clip duration defaults to 8 s (`VIDEO_DURATION_SEC`).
- Seedance 2.5 is not in `@fal-ai/client`'s typed endpoints yet. Its field names (`image_url`, `end_image_url`, `duration`, `aspect_ratio`) follow fal's model page; adjust `SEEDANCE_25` in `providers/fal.ts` if fal rejects them.
- SAM 2 on fal returns no score. "Confidence" is estimated from how well the mask fills the prompted box, and below 60 % the UI asks for a manual check.

Not built yet: user accounts (only an optional shared `API_TOKEN`), direct-to-R2 browser uploads (uploads go through the API, 40 MB limit), and audio/music in the final render.
