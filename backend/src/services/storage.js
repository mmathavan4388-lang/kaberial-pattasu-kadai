import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

const MAX_BYTES = 8 * 1024 * 1024;
let s3;

// Validates by decoding (magic bytes), strips metadata, bounds size and re-encodes to
// WebP. Only a file *reference* (URL) is ever stored in the database.
export async function saveImage(buffer, folder) {
  if (!buffer?.length || buffer.length > MAX_BYTES) throw new HttpError(400, 'invalid_image_size');
  let out;
  try {
    out = await sharp(buffer, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    throw new HttpError(400, 'invalid_image');
  }
  const key = `${folder}/${crypto.randomUUID()}.webp`;
  if (config.storage.driver === 's3') {
    s3 ||= new S3Client({ region: config.storage.region, endpoint: config.storage.endpoint, forcePathStyle: !!config.storage.endpoint });
    await s3.send(new PutObjectCommand({
      Bucket: config.storage.bucket, Key: key, Body: out, ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    return `${config.storage.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  const file = path.join(config.storage.localDir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, out);
  return `/uploads/${key}`;
}
