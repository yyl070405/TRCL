import path from 'node:path';
import fsp from 'node:fs/promises';
import { HOME, ensureDir, exists, readJson, writeJson } from './core/util.js';
import { MinecraftMeta } from './core/meta.js';
import { VersionInstaller } from './core/install.js';
import { InstanceManager } from './core/instances.js';
import { AccountStore, LoginSessions, MicrosoftAuth, offlineAuth } from './core/auth.js';
import { chooseJava, findJavas, installJre, probeJava } from './core/java.js';
import { buildCommand, launch as spawnLaunch, requiredJavaMajor } from './core/launch.js';
import { installLoader } from './core/loaders.js';
import { exportToFcl as exportInstanceToFcl } from './core/fcl.js';
import { ensureLanguage, readOptions, updateOptions, LANGUAGES } from './core/options.js';
import { inputAvailable } from './core/input.js';
import { screenAvailable } from './core/screen.js';

const DEFAULT_SETTINGS = {
  mirror: 'official',
  msClientId: '',
  javaPath: '',
  defaultMemoryMb: 2048,
  defaultWidth: 854,
  defaultHeight: 480,
  closeAfterLaunch: false,
  // 首次启动按浏览器/系统语言写 options.txt 的 lang
  autoLanguage: true,
  // 预留：自建下载镜像 / 更新接口。留空时仍走 Mojang 官方。
  mirrorBase: '',
  updateBase: '',
};

export class LauncherApp {
  constructor({ root = HOME, mirror } = {}) {
    this.root = root;
    this.settings = { ...DEFAULT_SETTINGS };
    if (mirror) this.settings.mirror = mirror;
    this.meta = new MinecraftMeta({ root, mirror: this.settings.mirror });
    this.installer = new VersionInstaller({ meta: this.meta, root });
    this.instances = new InstanceManager({ root });
    this.accounts = new AccountStore(root);
    this.running = new Map();
    this._javaCache = null;
    this._javaCacheAt = 0;
    this._sessions = null;
  }

  async init() {
    await ensureDir(this.root);
    await ensureDir(path.join(this.root, 'shared', 'versions'));
    await ensureDir(path.join(this.root, 'shared', 'libraries'));
    await ensureDir(path.join(this.root, 'shared', 'assets'));
    await ensureDir(path.join(this.root, 'instances'));
    const s = await readJson(path.join(this.root, 'settings.json'), null);
    if (s) this.settings = { ...DEFAULT_SETTINGS, ...s };
    this.meta = new MinecraftMeta({ root: this.root, mirror: this.settings.mirror });
    this.installer = new VersionInstaller({ meta: this.meta, root: this.root });
    await this.accounts.load();
    return this;
  }

  async saveSettings(patch) {
    const prevMirror = this.settings.mirror;
    this.settings = { ...this.settings, ...patch };
    if (this.settings.mirror !== prevMirror) {
      this.meta = new MinecraftMeta({ root: this.root, mirror: this.settings.mirror });
      this.installer = new VersionInstaller({ meta: this.meta, root: this.root });
    }
    if (patch.msClientId !== undefined) this._sessions = null;
    await writeJson(path.join(this.root, 'settings.json'), this.settings);
    return this.settings;
  }

  get auth() {
    return new MicrosoftAuth({ clientId: this.settings.msClientId });
  }

  get sessions() {
    if (!this._sessions) this._sessions = new LoginSessions(this.auth);
    return this._sessions;
  }

  async listJava(force = false) {
    if (!force && this._javaCache && Date.now() - this._javaCacheAt < 30000) return this._javaCache;
    const list = await findJavas(this.root);
    if (this.settings.javaPath) {
      const info = await probeJava(this.settings.javaPath);
      if (info) list.unshift(info);
    }
    this._javaCache = list.filter((j, i, arr) => arr.findIndex((x) => x.home === j.home) === i);
    this._javaCacheAt = Date.now();
    return this._javaCache;
  }

  async pickJava(instance, requiredMajor) {
    const list = (await this.listJava()).slice();
    if (instance.javaPath) {
      const info = await probeJava(instance.javaPath);
      if (info) return { java: info, compatible: info.major === requiredMajor || (requiredMajor >= 17 && info.major > requiredMajor) };
    }
    const chosen = chooseJava(list, requiredMajor);
    return chosen;
  }

  async ensureJava(major, onProgress) {
    const list = await this.listJava(true);
    const { java, compatible } = chooseJava(list, major);
    if (java && compatible) return java;
    onProgress?.({ phase: 'jre', label: `下载 Java ${major}…` });
    const info = await installJre(major, { root: this.root, onProgress });
    this._javaCache = null;
    return info;
  }

  /** 确保版本文件齐全；force 时做完整性校验并补全缺失文件。 */
  async prepareInstance(instance, onProgress = () => {}, { force = false } = {}) {
    let versionId = instance.versionId || instance.mcVersion;
    let loaderVersion = instance.loaderVersion;

    const jsonPath = path.join(this.meta.versionsDir, versionId, `${versionId}.json`);
    // versionId === mcVersion 说明加载器还没装（创建时先指向原版）
    const loaderPending =
      Boolean(instance.loaderType) && instance.loaderType !== 'vanilla' && versionId === instance.mcVersion;
    if (loaderPending || !(await exists(jsonPath))) {
      if (instance.loaderType && instance.loaderType !== 'vanilla') {
        const baseJson = await this.meta.versionJson(instance.mcVersion);
        const need = requiredJavaMajor(baseJson);
        const java = await this.ensureJava(need, onProgress);
        const res = await installLoader({
          type: instance.loaderType,
          mcVersion: instance.mcVersion,
          loaderVersion,
          meta: this.meta,
          root: this.root,
          javaPath: java.path,
          onProgress,
        });
        versionId = res.versionId;
        loaderVersion = res.loaderVersion;
        await this.instances.update(instance.id, { versionId, loaderVersion });
      } else {
        await this.meta.versionJson(versionId);
      }
    }

    // 保证继承链上的父版本 JSON 存在
    const json = await this.meta.versionJson(versionId);
    if (json.inheritsFrom) await this.meta.versionJson(json.inheritsFrom);

    if (force || !(await this.installer.isInstalled(versionId))) {
      await this.installer.install(versionId, { onProgress });
    }
    return { versionId, loaderVersion };
  }

  async launchInstance(instanceId, { onLine, onProgress = () => {}, locale } = {}) {
    let instance = await this.instances.get(instanceId);
    if (this.running.has(instanceId)) throw new Error('这个实例已经在运行');

    const account = this.accounts.current();
    if (!account) throw new Error('还没有账号，请先添加一个离线账号或微软账号');

    onProgress({ phase: 'prepare', label: '检查游戏文件…' });
    const { versionId } = await this.prepareInstance(instance, onProgress);
    instance = await this.instances.get(instanceId);

    const versionJson = await this.meta.resolve(versionId);
    versionJson._baseId = await this.installer.baseVersionId(versionId);
    const required = requiredJavaMajor(versionJson);

    let java = (await this.pickJava(instance, required)).java;
    if (!java) java = await this.ensureJava(required, onProgress);
    if (java.major !== required && !(required >= 17 && java.major > required)) {
      throw new Error(`Java 版本不匹配：需要 Java ${required}，当前是 ${java.version}`);
    }

    onProgress({ phase: 'prepare', label: '解压原生库…' });
    await this.installer.extractNatives(versionJson, path.join(instance.dir, 'natives'));

    // 首次启动按系统语言写 lang；已有 lang 时不覆盖玩家选择
    if (this.settings.autoLanguage !== false) {
      const lang = await ensureLanguage(instance.dir, locale || process.env.LANGUAGE || process.env.LANG || 'en_us');
      if (lang.changed) onProgress({ phase: 'prepare', label: `游戏语言设为 ${lang.lang}` });
    }

    const { command, cwd, env } = buildCommand({
      versionJson,
      instance,
      auth: account,
      javaPath: java.path,
      root: this.root,
      width: instance.width,
      height: instance.height,
    });

    onProgress({ phase: 'launch', label: '启动游戏…' });
    const handle = await spawnLaunch({
      command,
      cwd,
      env,
      logsDir: path.join(instance.dir, 'logs'),
      onLine,
    });
    this.running.set(instanceId, handle);
    handle.exited.finally(() => {
      this.running.delete(instanceId);
      this.instances.touch(instanceId).catch(() => {});
    });
    return { pid: handle.child.pid, logFile: handle.logFile, command, exited: handle.exited };
  }

  async stopInstance(id) {
    const handle = this.running.get(id);
    if (!handle) return false;
    try {
      handle.child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    // 最多等 6 秒，仍在运行就强杀，避免留下占着存档锁的僵尸进程
    for (let i = 0; i < 30; i++) {
      if (handle.child.exitCode !== null || handle.child.signalCode !== null) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      try {
        handle.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    this.running.delete(id);
    return true;
  }

  async runningInstanceIds() {
    return [...this.running.keys()];
  }

  async addOfflineAccount(name) {
    const account = offlineAuth(name);
    await this.accounts.add(account);
    return account;
  }

  async addMicrosoftAccount(sessionId) {
    const s = this.sessions.sessions.get(sessionId);
    if (!s?.account) throw new Error('登录尚未完成');
    await this.accounts.add(s.account);
    return s.account;
  }

  /** 汇总状态给 UI。 */
  async snapshot() {
    const [instances, java] = await Promise.all([this.instances.list(), this.listJava()]);
    const running = [...this.running.keys()];
    return {
      settings: this.settings,
      instances: instances.map((i) => ({ ...i, running: running.includes(i.id) })),
      accounts: this.accounts.list(),
      java,
      home: this.root,
      platform: process.platform,
      arch: process.arch,
      capabilities: {
        input: inputAvailable(),
        screen: screenAvailable(),
      },
      languages: LANGUAGES,
    };
  }

  async gameOptions(instanceId) {
    const instance = await this.instances.get(instanceId);
    return readOptions(instance.dir);
  }

  async saveGameOptions(instanceId, patch) {
    const instance = await this.instances.get(instanceId);
    return updateOptions(instance.dir, patch);
  }

  async installJreFor(major, onProgress) {
    const info = await installJre(major, { root: this.root, onProgress });
    this._javaCache = null;
    return info;
  }

  /** 把实例导出到 FCL，用它的 JRE + 渲染器在 Android 上真正启动。 */
  async exportFcl(instanceId, opts = {}) {
    const instance = await this.instances.get(instanceId);
    await this.prepareInstance(instance, opts.onProgress || (() => {}));
    return exportInstanceToFcl({
      instance,
      meta: this.meta,
      root: this.root,
      ...opts,
    });
  }

  async diskUsage() {
    return this.installer.diskUsage();
  }
}
