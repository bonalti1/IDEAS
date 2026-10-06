import fs from 'node:fs/promises'
import path from 'node:path'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface MediaStorage {
  readonly kind: string
  put(key: string, bytes: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  /** URL the browser can load. Signed for private buckets. */
  url(key: string): Promise<string>
}

function safeKey(key: string) {
  if (key.includes('..') || key.startsWith('/')) throw new Error(`Invalid storage key: ${key}`)
  return key
}

/** Local filesystem storage, served by the API at /media/<key>. */
export class LocalStorage implements MediaStorage {
  readonly kind: string
  constructor(private root: string) {
    this.kind = `local (${root})`
  }
  async put(key: string, bytes: Buffer) {
    const p = path.join(this.root, safeKey(key))
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, bytes, { flag: 'wx' }) // never overwrite: media is write-once
  }
  async get(key: string) {
    return fs.readFile(path.join(this.root, safeKey(key)))
  }
  async url(key: string) {
    return `/media/${safeKey(key)}`
  }
  filePath(key: string) {
    return path.join(this.root, safeKey(key))
  }
}

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl?: string // optional custom domain / r2.dev URL
  signedUrlTtlSec: number
}

/** Cloudflare R2 through its S3-compatible API. */
export class R2Storage implements MediaStorage {
  readonly kind: string
  private s3: S3Client
  constructor(private cfg: R2Config) {
    this.kind = `r2 (${cfg.bucket})`
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    })
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: safeKey(key),
        Body: bytes,
        ContentType: contentType,
        IfNoneMatch: '*', // write-once
      }),
    )
  }
  async get(key: string) {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: safeKey(key) }))
    return Buffer.from(await res.Body!.transformToByteArray())
  }
  async url(key: string) {
    if (this.cfg.publicBaseUrl) return `${this.cfg.publicBaseUrl.replace(/\/$/, '')}/${safeKey(key)}`
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: safeKey(key) }), {
      expiresIn: this.cfg.signedUrlTtlSec,
    })
  }
}
