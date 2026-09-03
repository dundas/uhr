import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function assertSafeTarget(root: string, target: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!contained(resolvedRoot, resolvedTarget)) {
    throw new Error(`Unsafe path outside root: ${resolvedTarget}`);
  }

  const rootStat = await lstat(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Unsafe root (must be a real directory): ${resolvedRoot}`);
  }

  const rootReal = await realpath(resolvedRoot);
  const parts = path.relative(resolvedRoot, resolvedTarget).split(path.sep);
  let current = resolvedRoot;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const currentStat = await lstat(current);
      if (currentStat.isSymbolicLink()) {
        throw new Error(`Unsafe symlink in target path: ${current}`);
      }
      const currentReal = await realpath(current);
      if (currentReal !== rootReal && !contained(rootReal, currentReal)) {
        throw new Error(`Unsafe resolved target outside root: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
}

export async function atomicWriteFile(
  root: string,
  target: string,
  data: string | Uint8Array,
  defaultMode = 0o600,
  preserveExistingMode = true
): Promise<void> {
  await assertSafeTarget(root, target);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await assertSafeTarget(root, target);

  let mode = defaultMode;
  try {
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new Error(`Unsafe config target (must be a regular file): ${target}`);
    }
    if (preserveExistingMode) mode = targetStat.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.uhr.tmp-${process.pid}-${randomUUID()}`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, mode);
    await assertSafeTarget(root, target);
    await rename(temporary, target);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
