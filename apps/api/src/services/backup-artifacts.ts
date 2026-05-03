import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, normalize, resolve, sep } from "node:path";

function sanitizeArtifactName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "artifact";
}

export class LocalBackupArtifactStore {
  readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(process.cwd(), baseDir);
  }

  buildJobArtifactPath(jobId: string, fileName: string): string {
    return `${sanitizeArtifactName(jobId)}/${sanitizeArtifactName(fileName)}`;
  }

  resolveRelativePath(relativePath: string): string {
    const normalized = normalize(relativePath).replace(/^([/\\])+/, "");
    const absolute = resolve(this.baseDir, normalized);

    if (absolute !== this.baseDir && !absolute.startsWith(`${this.baseDir}${sep}`)) {
      throw new Error(`Artifact path escapes artifact directory: ${relativePath}`);
    }

    return absolute;
  }

  async writeText(relativePath: string, content: string): Promise<void> {
    const absolutePath = this.resolveRelativePath(relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf-8");
  }

  async writeJson(relativePath: string, value: unknown): Promise<void> {
    await this.writeText(relativePath, JSON.stringify(value, null, 2));
  }

  async writeLines(relativePath: string, lines: Iterable<string> | AsyncIterable<string>): Promise<void> {
    const absolutePath = this.resolveRelativePath(relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const stream = createWriteStream(absolutePath, { encoding: "utf-8" });
      let wroteAny = false;

      const writeChunk = async () => {
        try {
          for await (const line of lines as AsyncIterable<string>) {
            const chunk = wroteAny ? `\n${line}` : line;
            wroteAny = true;
            if (!stream.write(chunk)) {
              await new Promise<void>((resume) => stream.once("drain", resume));
            }
          }
          stream.end();
        } catch (error) {
          stream.destroy();
          rejectPromise(error);
        }
      };

      stream.once("finish", () => resolvePromise());
      stream.once("error", (error) => rejectPromise(error));
      void writeChunk();
    });
  }

  async readText(relativePath: string): Promise<string> {
    return await readFile(this.resolveRelativePath(relativePath), "utf-8");
  }

  async readJson<T>(relativePath: string): Promise<T> {
    const text = await this.readText(relativePath);
    return JSON.parse(text) as T;
  }

  async readBuffer(relativePath: string): Promise<Buffer> {
    return await readFile(this.resolveRelativePath(relativePath));
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(this.resolveRelativePath(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async delete(relativePath: string | null | undefined): Promise<void> {
    if (!relativePath) {
      return;
    }

    try {
      await unlink(this.resolveRelativePath(relativePath));
    } catch {
      // 忽略缺失或重复删除。
    }
  }
}
