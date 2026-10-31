#!/usr/bin/env node
import { LauncherApp } from './app.js';
import { listMods } from './core/mods.js';
import { searchMods } from './core/modrinth.js';

const args = process.argv.slice(2);
const cmd = args[0];
const opts = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.join('=') || true];
    }),
);
const positional = args.slice(1).filter((a) => !a.startsWith('--'));

const app = await new LauncherApp({ root: opts.dir }).init();
const yes = (v) => v === true || v === 'true' || v === 'yes';

function usage() {
  console.log(`用法: node src/cli.js <命令> [参数]

  versions                列出可用正式版
  java                    列出检测到的 Java
  install <版本>          安装原版（例如 1.21.4）
  create <名称> --mc=1.21.4 --loader=fabric [--loader-version=0.16.9]
  list                    列出实例
  launch <实例名或 id>     启动
  mods <实例>             列出模组
  search <关键词> [--mc=] [--loader=]
  pack <mrpack 链接>       安装整合包

全局: --dir=/自定义/数据目录`);
}

if (!cmd || cmd === 'help') {
  usage();
  process.exit(0);
}

try {
  switch (cmd) {
    case 'versions': {
      const m = await app.meta.manifest();
      console.log(`最新正式版: ${m.latest.release}  快照: ${m.latest.snapshot}`);
      for (const v of m.versions.filter((x) => x.type === 'release').slice(0, 25)) {
        console.log(`  ${v.id.padEnd(10)} ${v.releaseTime.slice(0, 10)}`);
      }
      break;
    }
    case 'java': {
      const list = await app.listJava(true);
      if (!list.length) console.log('没有检测到 Java。');
      for (const j of list) console.log(`Java ${j.major} (${j.version}) ${j.path}`);
      break;
    }
    case 'install': {
      const id = positional[0];
      if (!id) throw new Error('需要版本号，例如: node src/cli.js install 1.21.4');
      const t0 = Date.now();
      const r = await app.installer.install(id, {
        onProgress: (p) => {
          if (p.phase === 'assets') process.stdout.write(`\r资源 ${p.done}/${p.total}   `);
          else if (p.label && p.phase === 'download') process.stdout.write(`\r${p.label.slice(0, 60)}          `);
        },
      });
      console.log(`\n安装完成 ${r.id}（${r.files} 个文件，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
      break;
    }
    case 'create': {
      const name = positional[0];
      if (!name || !opts.mc) throw new Error('用法: create <名称> --mc=<版本> [--loader=fabric]');
      const inst = await app.instances.create({
        name,
        mcVersion: opts.mc,
        loaderType: opts.loader || 'vanilla',
        loaderVersion: opts['loader-version'] || null,
      });
      console.log(`实例已创建: ${inst.id} (${inst.dir})`);
      await app.prepareInstance(inst, { onProgress: (p) => p.label && console.log(`  ${p.label}`) });
      console.log('安装完成。');
      break;
    }
    case 'list': {
      const list = await app.instances.list();
      for (const i of list) console.log(`${i.id.padEnd(28)} ${i.mcVersion.padEnd(8)} ${i.loaderType} ${i.loaderVersion || ''}`);
      if (!list.length) console.log('没有实例。');
      break;
    }
    case 'launch': {
      const key = positional[0];
      if (!key) throw new Error('需要实例名或 id');
      const list = await app.instances.list();
      const inst = list.find((i) => i.id === key) || list.find((i) => i.name === key);
      if (!inst) throw new Error(`找不到实例: ${key}`);
      if (!app.accounts.current()) await app.addOfflineAccount('Steve');
      const r = await app.launchInstance(inst.id, {
        onProgress: (p) => p.label && console.log(`[${p.phase}] ${p.label}`),
        onLine: (l) => console.log(l),
      });
      console.log(`已启动 pid=${r.pid}，日志: ${r.logFile}`);
      const exit = await r.exited;
      console.log(`退出码: ${exit.code}`);
      process.exit(exit.code ?? 0);
    }
    case 'mods': {
      const key = positional[0];
      const inst = (await app.instances.list()).find((i) => i.id === key || i.name === key);
      if (!inst) throw new Error('找不到实例');
      const mods = await listMods(inst.dir);
      for (const m of mods) console.log(`${m.enabled ? '✓' : '×'} ${m.name} ${m.version || ''}  ${m.file}`);
      if (!mods.length) console.log('没有模组。');
      break;
    }
    case 'search': {
      const q = positional.join(' ') || opts.q || '';
      const r = await searchMods({ query: q, gameVersion: opts.mc, loader: opts.loader, limit: 10 });
      for (const h of r.hits) console.log(`${h.title}  (${h.slug})  ↓${h.downloads}\n  ${h.description}`);
      break;
    }
    case 'export': {
      const inst = (await app.instances.list()).find((i) => i.id === positional[0] || i.name === positional[0]);
      if (!inst) throw new Error('找不到实例');
      const r = await app.exportInstance(inst.id, {
        format: opts.format || 'mrpack',
        includeSaves: Boolean(opts.saves),
      });
      console.log(`已导出 ${r.format}: ${r.file}`);
      console.log(`${(r.size / 1024).toFixed(1)} KB，${r.entries} 个文件`);
      break;
    }
    case 'pack': {
      const url = positional[0];
      if (!url) throw new Error('需要 .mrpack 链接');
      const { installMrpack } = await import('./core/modpack.js');
      const inst = await installMrpack({
        source: url,
        root: app.root,
        meta: app.meta,
        installer: app.installer,
        instances: app.instances,
        javaPath: (await app.listJava())[0]?.path,
        onProgress: (p) => p.label && console.log(`  ${p.label}`),
      });
      console.log(`整合包安装完成: ${inst.name} (${inst.id})`);
      break;
    }
    default:
      usage();
      process.exit(1);
  }
} catch (e) {
  console.error(`错误: ${e.message}`);
  process.exit(1);
}
