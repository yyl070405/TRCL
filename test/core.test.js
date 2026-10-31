import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { buildClasspath, buildCommand, tokenizeArgs } from '../src/core/launch.js';
import { buildFclSetting } from '../src/core/fcl.js';
import { applyArchCompat, ARM64_NATIVE_SUPPORT } from '../src/core/install.js';
import { ensureLanguage, mcLang, mergeOptions } from '../src/core/options.js';
import { mergeVersions } from '../src/core/meta.js';
import { matchesRules, defaultRuleContext } from '../src/core/rules.js';
import { mavenPath, offlineUuid, slugify } from '../src/core/util.js';

const baseVersion = {
  id: '1.20.1',
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  assetIndex: { id: '5' },
  javaVersion: { majorVersion: 17 },
  downloads: { client: { url: 'https://example.invalid/client.jar', size: 1 } },
  arguments: {
    jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}'],
  },
  libraries: [
    {
      name: 'com.example:lib:1.0',
      downloads: { artifact: { path: 'com/example/lib/1.0/lib-1.0.jar' } },
    },
    {
      name: 'org.lwjgl:lwjgl:3.3.1',
      downloads: {
        artifact: { path: 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar' },
        classifiers: { 'natives-linux': { path: 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-linux.jar' } },
      },
      natives: { linux: 'natives-linux' },
    },
  ],
};

const instance = { dir: '/tmp/mc-instance', memoryMb: 4096, jvmArgs: [] };
const auth = { name: 'Steve', uuid: '00000000-0000-3000-8000-000000000000', accessToken: '0', type: 'offline' };

test('buildCommand 把 mainClass 放在游戏参数前', () => {
  const { command } = buildCommand({
    versionJson: { ...baseVersion, _baseId: '1.20.1' },
    instance,
    auth,
    javaPath: '/usr/bin/java',
    root: '/tmp/mc-root',
  });
  const mainIdx = command.indexOf('net.minecraft.client.main.Main');
  const userIdx = command.indexOf('--username');
  assert.ok(mainIdx > 0);
  assert.ok(userIdx > mainIdx);
  assert.equal(command[command.indexOf('--username') + 1], 'Steve');
  assert.ok(command.includes('-Xmx4096M'));
  assert.ok(command.some((a) => a.includes('lib-1.0.jar')));
  assert.ok(!command.some((a) => a.includes('lwjgl-3.3.1.jar')), '带 natives 映射的库不应上 classpath');
});

test('classpath 使用平台分隔符并包含 client jar', () => {
  const { command, classpath } = buildCommand({
    versionJson: { ...baseVersion, _baseId: '1.20.1' },
    instance,
    auth,
    javaPath: 'java',
    root: '/tmp/mc-root',
  });
  const sep = process.platform === 'win32' ? ';' : ':';
  assert.ok(classpath.split(sep).length >= 2, classpath);
  assert.ok(classpath.endsWith(`1.20.1.jar`), classpath);
  const cpIdx = command.indexOf('-cp');
  assert.equal(command[cpIdx + 1], classpath);
});

test('旧版 minecraftArguments 也能拼装', () => {
  const legacy = {
    id: '1.7.10',
    mainClass: 'net.minecraft.client.main.Main',
    minecraftArguments: '--username ${auth_player_name} --session ${auth_session} --version ${version_name} --gameDir ${game_directory}',
    libraries: [],
    assetIndex: { id: '1.7.10' },
    javaVersion: { majorVersion: 8 },
  };
  const { command } = buildCommand({
    versionJson: { ...legacy, _baseId: '1.7.10' },
    instance,
    auth,
    javaPath: 'java',
    root: '/root/.mc',
  });
  assert.equal(command[command.indexOf('--session') + 1], '0');
  assert.equal(command[command.indexOf('--version') + 1], '1.7.10');
  assert.ok(command.includes('-Djava.library.path=/tmp/mc-instance/natives'));
  assert.ok(command.includes('-Dlog4j2.formatMsgNoLookups=true'));
});

test('tokenizeArgs 处理带引号参数', () => {
  assert.deepEqual(tokenizeArgs('--a 1 --b "x y"'), ['--a', '1', '--b', 'x y']);
});

test('mergeVersions 保留父库并让子覆盖 mainClass', () => {
  const parent = {
    id: '1.20.1',
    mainClass: 'net.minecraft.client.main.Main',
    libraries: [{ name: 'a:b:1' }],
    arguments: { game: ['--x'], jvm: ['-Dfoo=1'] },
  };
  const child = {
    id: 'fabric-loader-0.16-1.20.1',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [{ name: 'c:d:2' }],
    arguments: { game: [], jvm: ['-DFabricMcEmu=1'] },
    inheritsFrom: '1.20.1',
  };
  const merged = mergeVersions(parent, child);
  assert.equal(merged.id, child.id);
  assert.equal(merged.mainClass, child.mainClass);
  assert.equal(merged.libraries.length, 2);
  assert.deepEqual(merged.arguments.jvm, ['-Dfoo=1', '-DFabricMcEmu=1']);
  assert.equal(merged.inheritsFrom, undefined);
});

test('classpath 按坐标去重，加载器版本覆盖原版', () => {
  const v = {
    ...baseVersion,
    _baseId: '1.20.1',
    libraries: [
      { name: 'org.ow2.asm:asm:9.6', downloads: { artifact: { path: 'org/ow2/asm/asm/9.6/asm-9.6.jar' } } },
      { name: 'org.ow2.asm:asm:9.10.1', downloads: { artifact: { path: 'org/ow2/asm/asm/9.10.1/asm-9.10.1.jar' } } },
    ],
  };
  const cp = buildClasspath(v, { librariesDir: '/libs', clientJar: '/c/1.20.1.jar' }).join('|');
  assert.ok(cp.includes('asm-9.10.1.jar'));
  assert.ok(!cp.includes('asm-9.6.jar'));
});

test('现代 natives jar 留在 classpath，老式 natives 映射被排除', () => {
  const v = {
    libraries: [
      { name: 'org.lwjgl:lwjgl:3.3.3:natives-linux', downloads: { artifact: { path: 'natives/lwjgl-natives-linux.jar' } } },
      { name: 'org.lwjgl:lwjgl:2.9.4', natives: { linux: 'natives-linux' }, downloads: { artifact: { path: 'lwjgl-2.9.4.jar' } } },
    ],
  };
  const cp = buildClasspath(v, { librariesDir: '/libs', clientJar: null }).join('|');
  assert.ok(cp.includes('lwjgl-natives-linux.jar'));
  assert.ok(!cp.includes('lwjgl-2.9.4.jar'));
});

test('规则引擎按 os 过滤', () => {
  const ctx = defaultRuleContext({ osName: 'windows' });
  assert.equal(matchesRules([{ action: 'allow', os: { name: 'windows' } }], ctx), true);
  assert.equal(matchesRules([{ action: 'allow', os: { name: 'linux' } }], ctx), false);
  assert.equal(matchesRules(undefined, ctx), true);
  assert.equal(matchesRules([{ action: 'disallow', os: { name: 'windows' } }], ctx), false);
});

test('FCL 配置继承渲染器并覆盖内存', () => {
  const cfg = buildFclSetting(
    { memoryMb: 4096 },
    { renderer: 'com.fcl.plugin.mobileglues', driver: 'Turnip', graphicsBackend: 'default', vulkanDriverSystem: true, notCheckVulkan: true },
  );
  assert.equal(cfg.maxMemory, 4096);
  assert.equal(cfg.renderer, 'com.fcl.plugin.mobileglues');
  assert.equal(cfg.driver, 'Turnip');
  assert.equal(cfg.isolateGameDir, true);
  assert.equal(cfg.usesGlobal, false);

  const fallback = buildFclSetting({ memoryMb: 2048 }, null);
  assert.equal(fallback.renderer, undefined);
  assert.equal(fallback.maxMemory, 2048);
});

test('maven 坐标转路径', () => {
  assert.equal(mavenPath('net.fabricmc:fabric-loader:0.16.9'), 'net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar');
  assert.equal(
    mavenPath('org.lwjgl:lwjgl:3.3.3:natives-linux'),
    'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar',
  );
});

test('离线 UUID 稳定且符合格式', () => {
  const a = offlineUuid('Steve');
  const b = offlineUuid('Steve');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, offlineUuid('Alex'));
});

test('slugify 处理中文与非法字符', () => {
  assert.equal(slugify('我的世界 生存'), '我的世界-生存');
  assert.equal(slugify('a/b:c'), 'a-b-c');
  assert.equal(slugify(''), 'instance');
});

test('Linux ARM64 自动替换原生库', { skip: !ARM64_NATIVE_SUPPORT }, () => {
  const v = {
    libraries: [
      { name: 'org.lwjgl:lwjgl:3.3.3:natives-linux', downloads: { artifact: { path: 'x', url: 'https://libraries.minecraft.net/x' } } },
      { name: 'com.mojang:jtracy:1.0.29:natives-linux', downloads: { artifact: { path: 'j' } } },
      { name: 'com.mojang:jtracy:1.0.29', downloads: { artifact: { path: 'jt.jar' } } },
    ],
  };
  const out = applyArchCompat(v);
  assert.equal(out.libraries.length, 2);
  const lwjgl = out.libraries.find((l) => l.name.startsWith('org.lwjgl:lwjgl'));
  assert.equal(lwjgl.name, 'org.lwjgl:lwjgl:3.3.3:natives-linux-arm64');
  assert.ok(lwjgl.downloads.artifact.url.startsWith('https://repo1.maven.org/'));
  assert.ok(lwjgl.downloads.artifact.path.endsWith('natives-linux-arm64.jar'));
  assert.ok(out.libraries.some((l) => l.name === 'com.mojang:jtracy:1.0.29'));
});

test('日志配置路径变量被替换', () => {
  const v = {
    ...baseVersion,
    id: '1.21.4',
    logging: { client: { argument: '-Dlog4j.configurationFile=${path}', file: { id: 'client-1.12.xml' } } },
    arguments: { jvm: ['-Dlog4j.configurationFile=${path}', '-cp', '${classpath}'], game: [] },
    _baseId: '1.21.4',
  };
  const { command } = buildCommand({ versionJson: v, instance, auth, javaPath: 'java', root: '/tmp/r' });
  const arg = command.find((a) => a.startsWith('-Dlog4j.configurationFile='));
  assert.equal(arg, path.join('/tmp/r/shared/assets/log_configs/client-1.12.xml').replace(/^/, '-Dlog4j.configurationFile='));
});

test('游戏语言映射', () => {
  assert.equal(mcLang('zh-CN'), 'zh_cn');
  assert.equal(mcLang('zh-TW'), 'zh_tw');
  assert.equal(mcLang('en-GB'), 'en_gb');
  assert.equal(mcLang('ja-JP'), 'ja_jp');
  assert.equal(mcLang('fr'), 'fr_fr');
  assert.equal(mcLang(''), 'en_us');
});

test('options.txt 合并且保留未知键', () => {
  const text = 'version:4189\nlang:en_us\nfov:0.0\nguiScale:0\n';
  const out = mergeOptions(text, { lang: 'zh_cn', renderDistance: 8 });
  assert.ok(out.includes('version:4189'));
  assert.ok(out.includes('lang:zh_cn'));
  assert.ok(!out.includes('lang:en_us'));
  assert.ok(out.includes('renderDistance:8'));
  assert.ok(out.split('\n')[0] === 'version:4189', '保持键顺序');
});

test('首次启动自动写语言且不覆盖已有选择', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-opt-'));
  const first = await ensureLanguage(dir, 'zh-CN');
  assert.equal(first.changed, true);
  assert.equal(first.lang, 'zh_cn');
  const second = await ensureLanguage(dir, 'en-US');
  assert.equal(second.changed, false);
  assert.equal(second.lang, 'zh_cn');
});
