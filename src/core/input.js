import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** HUD 按钮 → 键盘按键。 */
export const KEYMAP = {
  forward: 'w',
  back: 's',
  left: 'a',
  right: 'd',
  jump: 'space',
  sneak: 'shift',
  sprint: 'ctrl',
  inventory: 'e',
  chat: 't',
  drop: 'q',
  pause: 'escape',
  debug: 'f3',
  perspective: 'f5',
  swap: 'f',
  screenshot: 'f2',
};

export function inputAvailable() {
  return process.platform === 'linux' && Boolean(process.env.DISPLAY);
}

async function run(args) {
  return execFileAsync('xdotool', args, { timeout: 5000, maxBuffer: 1024 * 1024 });
}

let focused = null;

/** 让游戏窗口获得焦点，按键才会生效。 */
export async function focusGame() {
  try {
    const { stdout } = await run(['search', '--onlyvisible', '--name', 'Minecraft']);
    const ids = stdout.trim().split('\n').filter(Boolean);
    const id = ids[ids.length - 1];
    if (id) {
      await run(['windowactivate', '--sync', id]);
      focused = id;
    }
    return id || null;
  } catch {
    return null;
  }
}

export async function sendKey(name, action = 'tap') {
  if (!inputAvailable()) throw new Error('当前环境没有可发送按键的显示器（需要 Linux + DISPLAY + xdotool）');
  const key = KEYMAP[name] || name;
  if (!/^[A-Za-z0-9_+\-]+$/.test(key)) throw new Error(`非法按键: ${key}`);
  if (!focused) await focusGame();
  if (action === 'down') await run(['keydown', '--clearmodifiers', key]);
  else if (action === 'up') await run(['keyup', '--clearmodifiers', key]);
  else await run(['key', '--clearmodifiers', key]);
  return true;
}

/** 鼠标相对移动，用来做视角拖动。 */
export async function look(dx, dy) {
  if (!inputAvailable()) throw new Error('当前环境没有可用的显示器');
  const x = Math.max(-400, Math.min(400, Math.round(Number(dx) || 0)));
  const y = Math.max(-400, Math.min(400, Math.round(Number(dy) || 0)));
  if (!x && !y) return true;
  if (!focused) await focusGame();
  await run(['mousemove_relative', '--', String(x), String(y)]);
  return true;
}
