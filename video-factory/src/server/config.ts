// All provider model IDs, keys and infrastructure choices come from the
// environment. Nothing else in the app hard-codes a model ID.

const env = (k: string, d = '') => (process.env[k] ?? d).trim()
const num = (k: string, d: number) => {
  const v = Number(process.env[k])
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d
}
const bool = (k: string, d = false) => {
  const v = process.env[k]
  return v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
}

export function loadConfig() {
  return {
    port: num('API_PORT', 8787),
    dataDir: env('DATA_DIR', 'data'),
    // When true, any provider without an API key is replaced by a local fake.
    // Keeps the whole workflow runnable on a laptop without spending credits.
    fakeMissingProviders: bool('FAKE_MISSING_PROVIDERS', true),

    openai: {
      apiKey: env('OPENAI_API_KEY'),
      visionModel: env('OPENAI_VISION_MODEL', 'gpt-5.5'),
      visionReasoning: env('OPENAI_VISION_REASONING', 'medium') as 'low' | 'medium' | 'high',
      imageModel: env('OPENAI_IMAGE_MODEL', 'gpt-image-2.5-sunburst'),
      imageQuality: env('OPENAI_IMAGE_QUALITY', 'high'),
      imageEnabled: bool('OPENAI_IMAGE_ENABLED', true),
    },
    gemini: {
      apiKey: env('GEMINI_API_KEY'),
      imageModel: env('GEMINI_IMAGE_MODEL', 'gemini-3-pro-image-preview'),
      imageSize: env('GEMINI_IMAGE_SIZE', '2K'),
      veoModel: env('VEO_MODEL', 'veo-3.1-generate-preview'),
      veoResolution: env('VEO_RESOLUTION', '720p'),
    },
    fal: {
      key: env('FAL_KEY'),
      klingEndpoint: env('FAL_KLING_ENDPOINT', 'fal-ai/kling-video/v3/pro/image-to-video'),
      klingEnabled: bool('FAL_KLING_ENABLED', true),
      seedanceEndpoint: env('FAL_SEEDANCE_ENDPOINT', 'bytedance/seedance-2.5/image-to-video'),
      seedanceEnabled: bool('FAL_SEEDANCE_ENABLED', true),
      sam2Endpoint: env('FAL_SAM2_ENDPOINT', 'fal-ai/sam2/image'),
    },
    video: {
      durationSec: num('VIDEO_DURATION_SEC', 8),
      pollIntervalSec: num('VIDEO_POLL_INTERVAL_SEC', 10),
      maxPolls: num('VIDEO_MAX_POLLS', 90),
      reviewFrames: num('CLIP_REVIEW_FRAMES', 4),
    },
    supabase: {
      url: env('SUPABASE_URL'),
      serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    },
    r2: {
      accountId: env('R2_ACCOUNT_ID'),
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
      bucket: env('R2_BUCKET'),
      publicBaseUrl: env('R2_PUBLIC_BASE_URL') || undefined,
      signedUrlTtlSec: num('R2_SIGNED_URL_TTL_SEC', 3600),
    },
    inngest: {
      enabled: bool('INNGEST_ENABLED', false),
      appId: env('INNGEST_APP_ID', 'alto-video-factory'),
    },
    render: {
      // 'remotion' renders branded intro/outro cards with Remotion; 'ffmpeg' uses static SVG title cards.
      engine: env('RENDER_ENGINE', 'ffmpeg') as 'ffmpeg' | 'remotion',
      browserExecutable: env('REMOTION_BROWSER_EXECUTABLE') || undefined,
      logoFile: env('ALTO_LOGO_FILE') || undefined,
    },
    // After each approval, start preparing the next proposal (analysis, mask,
    // plan, next prompt). Approvals themselves always stay manual.
    autoAdvance: bool('AUTO_ADVANCE', true),
    apiToken: env('API_TOKEN'), // optional shared bearer token for the internal API
  }
}

export type AppConfig = ReturnType<typeof loadConfig>
