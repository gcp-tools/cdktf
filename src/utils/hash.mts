import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const IGNORE_PATTERNS = [
  /node_modules/,
  /dist/,
  /build/,
  /target/,
  /\.git/,
  /\.terraform/,
  /\.cdktf/,
  /coverage/,
  /\.nyc_output/,
  /\.next/,
  /\.nuxt/,
  /\.cache/,
  /tmp/,
  /temp/,
  /\.log$/,
  /Thumbs\.db$/,
  /\.DS_Store$/,
];

function getFilePaths(dir: string, allPaths: string[] = []): string[] {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (IGNORE_PATTERNS.some((pattern) => pattern.test(fullPath))) {
      continue;
    }

    if (statSync(fullPath).isDirectory()) {
      getFilePaths(fullPath, allPaths);
    } else {
      allPaths.push(fullPath);
    }
  }
  return allPaths;
}

/**
 * Computes a stable SHA256 hash of a source directory's contents.
 * This function runs at synthesis time to provide a deterministic trigger for deployments.
 * @param sourceDir The directory to hash.
 * @returns A 12-character hex hash of the directory contents.
 */
export function computeSourceHash(sourceDir: string): string {
  const hash = createHash('sha256');
  try {
    const filePaths = getFilePaths(sourceDir).sort();

    if (filePaths.length === 0) {
      console.warn(
        `Warning: No files found for hashing in ${sourceDir}. This may be expected.`,
      );
      return 'no-source-files';
    }

    for (const filePath of filePaths) {
      const data = readFileSync(filePath);
      hash.update(filePath); // Include file path to handle empty files/renames
      hash.update(data);
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.warn(
        `Warning: Source directory not found at ${sourceDir}. This is expected during plan phase without local source.`,
      );
      return 'source-dir-not-found';
    }
    throw error;
  }

  return hash.digest('hex').substring(0, 12);
}
