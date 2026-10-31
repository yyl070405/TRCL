import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { defaultRuleContext, flattenArguments, matchesRules, substitute } from './rules.js';
import { ensureDir, exists, mavenPath } from './util.js';
import { dedupeLibraries, applyArchCompat } from './install.js';

/** 把 minecraftArguments 这种老式字符串按空格切开，支持双引号。 */
export function tokenizeArgs(str) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of String(str || '')) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function libraryJarPath(lib, librariesDir, fallbackBase = 'https://libraries.minecraft.net') {
  if (lib.downloads?.artifact?.path) return path.join(librariesDir, lib.downloads.artifact.path);
  if (!lib.name) return null;
  try {
    return path.join(librariesDir, mavenPath(lib.name));
  } catch {
    return null;
  }
}

export function buildClasspath(versionJson, { librariesDir, clientJar }) {
  const ctx = defaultRuleContext();
  const entries = [];
  for (const lib of dedupeLibraries(versionJson.libraries || [])) {
    if (!matchesRules(lib.rules, ctx)) continue;
    // 1.18 及更早的原生库带 natives 映射，会解压到 natives 目录，不能上 classpath；
    // 1.19+ 的原生库是普通 classifier jar，必须留在 classpath 上交给 LWJGL 自己解压。
    if (lib.natives) continue;
    const p = libraryJarPath(lib, librariesDir);
    if (p) entries.push(p);
  }
  if (clientJar) entries.push(clientJar);
  return entries;
}

export function requiredJavaMajor(versionJson) {
  return versionJson.javaVersion?.majorVersion || 8;
}

/**
 * 纯函数：生成 java 命令行。便于单元测试，不依赖进程。
 */
export function buildCommand({ versionJson, instance, auth, javaPath, root, width, height, extraJvmArgs = [] }) {
  versionJson = applyArchCompat(versionJson);
  const sep = process.platform === 'win32' ? ';' : ':';
  const shared = path.join(root, 'shared');
  const librariesDir = path.join(shared, 'libraries');
  const assetsDir = path.join(shared, 'assets');
  const gameDir = instance.dir;
  const nativesDir = path.join(gameDir, 'natives');
  const versionId = versionJson.id;
  const jarId = versionJson.jar || versionJson._baseId || versionId;
  const clientJar = path.join(shared, 'versions', jarId, `${jarId}.jar`);

  const classpath = buildClasspath(versionJson, { librariesDir, clientJar }).join(sep);
  const assetsIndex = versionJson.assetIndex?.id || versionJson.assets || 'legacy';

  const logConfig = versionJson.logging?.client?.file
    ? path.join(assetsDir, 'log_configs', versionJson.logging.client.file.id)
    : '';

  const vars = {
    path: logConfig,
    auth_player_name: auth.name,
    auth_uuid: auth.uuid,
    auth_access_token: auth.accessToken,
    auth_session: auth.accessToken,
    auth_xuid: auth.xuid || '',
    clientid: auth.clientId || '',
    user_type: auth.type === 'msa' ? 'msa' : auth.userType || 'legacy',
    user_properties: '{}',
    version_name: versionJson.id,
    version_type: versionJson.type || 'release',
    game_directory: gameDir,
    game_assets: path.join(assetsDir, 'virtual', 'legacy'),
    assets_root: assetsDir,
    assets_index_name: assetsIndex,
    natives_directory: nativesDir,
    launcher_name: 'MCLauncher',
    launcher_version: '0.1.0',
    classpath,
    classpath_separator: sep,
    library_directory: librariesDir,
    resolution_width: width || 854,
    resolution_height: height || 480,
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: '',
    quickPlayRealms: '',
  };

  const ctx = defaultRuleContext({
    features: {
      is_demo_user: false,
      has_custom_resolution: Boolean(width && height),
      has_quick_plays_support: false,
      is_quick_play_singleplayer: false,
      is_quick_play_multiplayer: false,
      is_quick_play_realms: false,
    },
  });

  const jvm = [];
  const memory = instance.memoryMb || 2048;
  jvm.push(`-Xmx${memory}M`);
  if (instance.minMemoryMb) jvm.push(`-Xms${instance.minMemoryMb}M`);
  jvm.push(...(instance.jvmArgs || []).filter(Boolean));
  jvm.push(...extraJvmArgs);

  if (versionJson.arguments?.jvm) {
    jvm.push(...flattenArguments(versionJson.arguments.jvm, ctx));
  } else {
    jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', classpath);
  }

  const game = versionJson.arguments?.game
    ? flattenArguments(versionJson.arguments.game, ctx)
    : tokenizeArgs(versionJson.minecraftArguments);

  const jvmArgs = jvm.map((a) => substitute(a, vars));
  const gameArgs = game.map((a) => substitute(a, vars));

  if ((versionJson.javaVersion?.majorVersion || 8) <= 8) {
    jvmArgs.unshift('-Dlog4j2.formatMsgNoLookups=true');
  }

  const command = [javaPath, ...jvmArgs, versionJson.mainClass, ...gameArgs];

  return {
    command,
    cwd: gameDir,
    env: { ...process.env },
    classpath,
    nativesDir,
    assetsDir,
    gameDir,
    logConfig: versionJson.logging?.client?.argument || null,
  };
}

const TS = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * 真正启动进程，转发输出到回调并写日志文件。
 */
export async function launch({ command, cwd, env, logsDir, onLine }) {
  await ensureDir(logsDir);
  const logFile = path.join(logsDir, `${TS()}.log`);
  const stream = fs.createWriteStream(logFile, { flags: 'a' });

  const emit = (line) => {
    stream.write(line.endsWith('\n') ? line : `${line}\n`);
    onLine?.(line);
  };

  emit(`[launcher] ${new Date().toISOString()}`);
  emit(`[launcher] ${cwd}`);
  emit(`[launcher] ${command[0]} ${command.slice(1).join(' ')}`);

  const child = spawn(command[0], command.slice(1), {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  const pump = (src, tag) => {
    let buffer = '';
    src.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) emit(tag ? `[${tag}] ${line}` : line);
    });
    src.on('end', () => {
      if (buffer) emit(tag ? `[${tag}] ${buffer}` : buffer);
    });
  };
  pump(child.stdout);
  pump(child.stderr, 'stderr');

  const exited = new Promise((resolve) => {
    child.on('error', (e) => {
      emit(`[launcher] 启动失败: ${e.message}`);
      stream.end();
      resolve({ code: -1, error: e.message });
    });
    child.on('exit', (code, signal) => {
      emit(`[launcher] 进程退出 code=${code} signal=${signal || ''}`);
      stream.end();
      resolve({ code, signal });
    });
  });

  return { child, logFile, exited };
}
