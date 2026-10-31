import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TMP = path.join(os.tmpdir(), 'mc-screen.png');

export function screenAvailable() {
  return process.platform === 'linux' && Boolean(process.env.DISPLAY);
}

/** 截取当前 X 显示（Xvfb / Termux:X11），返回 PNG buffer。 */
export async function captureScreen() {
  if (!screenAvailable()) throw new Error('没有可截取的显示器（需要 Linux + DISPLAY）');
  await execFileAsync('scrot', ['-o', TMP], { timeout: 10000 });
  const buffer = await fsp.readFile(TMP);
  return buffer;
}
