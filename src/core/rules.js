/**
 * Mojang 规则引擎：os / arch / version 正则 / features。
 * 语义：无 rules 视为允许；有 rules 时默认拒绝，逐条匹配并覆盖 action。
 */
export function currentOsName(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'osx';
  return 'linux';
}

export function currentArch(arch = process.arch) {
  if (arch === 'x64') return 'x86_64';
  if (arch === 'ia32') return 'x86';
  return 'arm64';
}

export function defaultRuleContext(overrides = {}) {
  return {
    osName: currentOsName(),
    osArch: currentArch(),
    osVersion: '',
    features: {},
    ...overrides,
  };
}

function ruleMatches(rule, ctx) {
  if (rule.os) {
    const { name, arch, version } = rule.os;
    if (name && name !== ctx.osName) return false;
    if (arch && arch !== ctx.osArch) return false;
    if (version) {
      try {
        if (!new RegExp(version).test(ctx.osVersion)) return false;
      } catch {
        return false;
      }
    }
    // osx 的 arch 规则在部分版本里写成 "x86"，这里按实际处理
  }
  if (rule.features) {
    for (const [key, val] of Object.entries(rule.features)) {
      if (Boolean(ctx.features[key]) !== Boolean(val)) return false;
    }
  }
  return true;
}

export function matchesRules(rules, ctx = defaultRuleContext()) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (!ruleMatches(rule, ctx)) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

/** 展开 arguments 数组里的 ${...} 变量。 */
export function substitute(value, vars) {
  return String(value).replace(/\$\{([^}]+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
    return m;
  });
}

/** 从 arguments 数组展开参数（会跳过不匹配的 rules 项）。 */
export function flattenArguments(list, ctx) {
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object' && matchesRules(item.rules, ctx)) {
      if (typeof item.value === 'string') out.push(item.value);
      else if (Array.isArray(item.value)) out.push(...item.value);
    }
  }
  return out;
}
