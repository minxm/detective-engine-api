import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** CI 写入 dist/BUILD_SHA.txt，便于 /health 校验线上版本 */
export function getBuildSha(): string | undefined {
  const fromEnv = process.env.BUILD_SHA?.trim();
  if (fromEnv) return fromEnv;

  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '../../BUILD_SHA.txt'),
      path.resolve(here, '../BUILD_SHA.txt'),
    ];
    for (const stamp of candidates) {
      if (existsSync(stamp)) {
        return readFileSync(stamp, 'utf8').trim() || undefined;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}
