import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { buildClasspath, buildCommand, tokenizeArgs } from '../src/core/launch.js';
import { applyArchCompat, ARM64_NATIVE_SUPPORT } from '../src/core/install.js';
import { ensureLanguage, mcLang, mergeOptions } from '../src/core/options.js';
import { mergeVersions } from '../src/core/meta.js';
import { createZip } from '../src/core/zip-write.js';
import { readZipEntries, readEntryData, extractTarGz } from '../src/core/zip.js';
import { mrpackIndex, mmcPack } from '../src/core/export.js';
import { matchesRules, defaultRuleContext } from '../src/core/rules.js';
import { mavenPath, offlineUuid, slugify } from '../src/core/util.js';
import { standardJavaDirs } from '../src/core/java.js';
import { pickZuluPackage, zuluQuery, zuluTarget } from '../src/core/zulu.js';
import { isArchiveMagic, oracleTarget, parseOracleLinks, pickOraclePackage } from '../src/core/oracle.js';

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

test('ZIP 写入后可被读取', () => {
  const zip = createZip(new Map([
    ['a.txt', 'hello'],
    ['dir/b.json', JSON.stringify({ ok: true })],
  ]));
  const entries = readZipEntries(zip);
  assert.equal(entries.length, 2);
  const a = entries.find((e) => e.name === 'a.txt');
  assert.equal(readEntryData(zip, a).toString('utf8'), 'hello');
});

test('mrpack 清单包含加载器依赖', () => {
  const index = mrpackIndex({ name: '测试', mcVersion: '1.21.4', loaderType: 'fabric', loaderVersion: '0.20.1' });
  assert.equal(index.dependencies.minecraft, '1.21.4');
  assert.equal(index.dependencies['fabric-loader'], '0.20.1');
  assert.equal(index.formatVersion, 1);
});

test('MultiMC 清单包含原版与加载器组件', () => {
  const pack = mmcPack({ mcVersion: '1.20.1', loaderType: 'forge', loaderVersion: '47.2.0' });
  assert.equal(pack.components[0].uid, 'net.minecraft');
  assert.equal(pack.components[1].uid, 'net.minecraftforge');
  assert.equal(pack.components[1].version, '47.2.0');
});

test('Zulu 平台映射按系统与架构', () => {
  assert.deepEqual(zuluTarget('win32', 'x64'), { os: 'windows', arch: 'x64', archiveType: 'zip' });
  assert.deepEqual(zuluTarget('darwin', 'arm64'), { os: 'macos', arch: 'aarch64', archiveType: 'tar.gz' });
  assert.deepEqual(zuluTarget('linux', 'arm64'), { os: 'linux', arch: 'aarch64', archiveType: 'tar.gz' });
});

test('Zulu 查询串带版本、平台与包类型', () => {
  const url = zuluQuery(25, zuluTarget('linux', 'arm64'), 'jre');
  assert.match(url, /java_version=25/);
  assert.match(url, /os=linux/);
  assert.match(url, /arch=aarch64/);
  assert.match(url, /java_package_type=jre/);
  assert.match(url, /release_status=ga/);
});

test('Zulu 包选择排除 CRaC 与 musl，取最高版本', () => {
  const target = zuluTarget('linux', 'x64');
  const list = [
    { name: 'zulu21.30.15-ca-jre21.0.2-linux_x64.tar.gz', download_url: 'u1', java_version: [21, 0, 2, 0, 0] },
    { name: 'zulu21.40.17-ca-jre21.0.5-linux_x64.tar.gz', download_url: 'u2', java_version: [21, 0, 5, 0, 0] },
    { name: 'zulu21.40.17-ca-crac-jre21.0.5-linux_x64.tar.gz', download_url: 'u3', java_version: [21, 0, 5, 0, 0] },
    { name: 'zulu21.40.17-ca-jre21.0.5-linux_musl_x64.tar.gz', download_url: 'u4', java_version: [21, 0, 5, 0, 0] },
    { name: 'zulu21.40.17-ca-jre21.0.5-win_x64.zip', download_url: 'u5', java_version: [21, 0, 5, 0, 0] },
  ];
  const pkg = pickZuluPackage(list, target);
  assert.equal(pkg.download_url, 'u2');
});

test('tar 解压保留可执行位', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'trcl-tar-'));
  await fsp.mkdir(path.join(dir, 'src', 'bin'), { recursive: true });
  const javaFile = path.join(dir, 'src', 'bin', 'java');
  await fsp.writeFile(javaFile, '#!/bin/sh\necho hi\n');
  await fsp.chmod(javaFile, 0o755);
  await fsp.writeFile(path.join(dir, 'src', 'readme.txt'), 'x');
  await promisify(execFile)('tar', ['-czf', path.join(dir, 'a.tar.gz'), '-C', path.join(dir, 'src'), '.']);
  const out = path.join(dir, 'out');
  await extractTarGz(path.join(dir, 'a.tar.gz'), out);
  const bin = path.join(out, 'bin', 'java');
  assert.equal((await fsp.stat(bin)).mode & 0o111, 0o111);
  assert.equal(await fsp.readFile(bin, 'utf8'), '#!/bin/sh\necho hi\n');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('Oracle 下载页解析出 jdk/jre 链接', () => {
  const html = `
    <a href="https://download.oracle.com/otn/java/jdk/21.0.13.0.3%2B1/abc/jdk-21.0.13.0.3_linux-aarch64_bin.tar.gz">x</a>
    <a href="https://download.oracle.com/otn/java/jdk/8u511-b33/def/jre-8u511-linux-x64.tar.gz">y</a>
    <a href="https://download.oracle.com/java/25/latest/jdk-25_windows-x64_bin.zip">z</a>`;
  const links = parseOracleLinks(html);
  assert.equal(links.length, 3);
  assert.deepEqual(
    links.map((l) => [l.kind, l.major, l.os, l.arch, l.ext]),
    [
      ['jdk', 21, 'linux', 'aarch64', 'tar.gz'],
      ['jre', 8, 'linux', 'x64', 'tar.gz'],
      ['jdk', 25, 'windows', 'x64', 'zip'],
    ],
  );
});

test('Oracle 选包优先 JRE，且匹配平台架构', () => {
  const links = [
    { kind: 'jdk', major: 17, version: '17.0.21.0.3', url: 'a', os: 'linux', arch: 'aarch64', ext: 'tar.gz' },
    { kind: 'jre', major: 17, version: '17.0.2', url: 'b', os: 'linux', arch: 'aarch64', ext: 'tar.gz' },
    { kind: 'jdk', major: 17, version: '17.0.21.0.3', url: 'c', os: 'linux', arch: 'x64', ext: 'tar.gz' },
  ];
  assert.equal(pickOraclePackage(links, oracleTarget('linux', 'arm64'), 17).url, 'b');
  assert.equal(pickOraclePackage(links, oracleTarget('linux', 'x64'), 17).url, 'c');
  assert.equal(pickOraclePackage(links, oracleTarget('darwin', 'arm64'), 17), null);
});

test('Oracle 下载结果校验：登录页不算安装包', () => {
  const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const html = Buffer.from('<HTML>');
  assert.equal(isArchiveMagic(gz, 'jdk-21_linux-aarch64_bin.tar.gz'), true);
  assert.equal(isArchiveMagic(zip, 'jdk-21_windows-x64_bin.zip'), true);
  assert.equal(isArchiveMagic(html, 'jdk-21_linux-aarch64_bin.tar.gz'), false);
});

test('Windows 的 Java 搜索目录覆盖主流发行版', () => {
  const dirs = standardJavaDirs({
    platform: 'win32',
    env: { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\Local', APPDATA: 'C:\\Roaming' },
    home: 'C:\\Users\\me',
  });
  for (const want of ['C:\\PF\\Java', 'C:\\PF\\Zulu', 'C:\\PF\\Eclipse Adoptium', 'C:\\PF\\Amazon Corretto', 'C:\\Local\\Programs\\Zulu']) {
    assert.ok(dirs.includes(want), `缺少 ${want}`);
  }
  assert.ok(dirs.some((d) => d.includes('Microsoft')));
});

test('macOS 与 Linux 的 Java 搜索目录', () => {
  const mac = standardJavaDirs({ platform: 'darwin', home: '/Users/me' });
  assert.ok(mac.includes('/Library/Java/JavaVirtualMachines'));
  const linux = standardJavaDirs({ platform: 'linux', home: '/home/me' });
  assert.ok(linux.includes('/usr/lib/jvm'));
});
