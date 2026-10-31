import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, exists, offlineUuid, readJson, uuidV4, writeJson } from './util.js';

const XBL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';
const DEVICE_CODE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const SCOPE = 'XboxLive.signin offline_access';

export function offlineAuth(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) {
    throw new Error('离线用户名需为 3-16 位字母、数字或下划线');
  }
  return {
    type: 'offline',
    name: clean,
    uuid: offlineUuid(clean),
    accessToken: '0',
    userType: 'legacy',
  };
}

export class MicrosoftAuth {
  constructor({ clientId, fetchImpl = fetch } = {}) {
    this.clientId = clientId;
    this.fetch = fetchImpl;
  }

  requireClientId() {
    if (!this.clientId) {
      throw new Error(
        '未配置微软应用 client id。请在设置里填入 Azure 应用的 client id（类型选“移动和桌面应用”），或先用离线登录。',
      );
    }
  }

  async post(url, body, headers = {}) {
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...headers },
      body: typeof body === 'string' ? body : new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(data.error_description || data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data.error;
      err.data = data;
      throw err;
    }
    return data;
  }

  async json(url, body, token) {
    const res = await this.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.errorMessage || data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /** 第一步：拿设备码，把 user_code 展示给用户。 */
  async startDeviceCode() {
    this.requireClientId();
    const data = await this.post(DEVICE_CODE, { client_id: this.clientId, scope: SCOPE });
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval || 5,
      message: data.message,
    };
  }

  /** 轮询一次；pending 表示用户还没完成授权。 */
  async pollOnce(deviceCode) {
    try {
      const data = await this.post(TOKEN, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: this.clientId,
        device_code: deviceCode,
      });
      return { pending: false, tokens: data };
    } catch (e) {
      if (e.code === 'authorization_pending' || e.code === 'slow_down') return { pending: true, slowDown: e.code === 'slow_down' };
      if (e.code === 'expired_token') throw new Error('设备码已过期，请重新开始登录');
      if (e.code === 'authorization_declined') throw new Error('用户取消了登录授权');
      throw e;
    }
  }

  /** 用 Microsoft token 换 Minecraft 账号。 */
  async complete(tokens) {
    const xbl = await this.json(XBL, {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${tokens.access_token}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    });

    let xsts;
    try {
      xsts = await this.json(XSTS, {
        Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      });
    } catch (e) {
      const xerr = e.data?.XErr;
      const map = {
        2148916233: '该微软账号没有 Xbox 账号，请先在 xbox.com 创建',
        2148916235: '该账号所在地区不支持 Xbox Live',
        2148916238: '未成年账号需要先加入家庭组',
      };
      throw new Error(map[xerr] || `Xbox 认证失败 (XErr=${xerr ?? '未知'})`);
    }

    const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs;
    const mc = await this.json(MC_LOGIN, { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });

    const profile = await this.profile(mc.access_token);
    return {
      type: 'msa',
      name: profile.name,
      uuid: profile.id,
      accessToken: mc.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (mc.expires_in || 86400) * 1000,
      xuid: profile.xuid,
      skins: profile.skins,
    };
  }

  async profile(accessToken) {
    const res = await this.fetch(MC_PROFILE, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 404) throw new Error('该账号没有购买 Minecraft: Java 版');
    if (!res.ok) throw new Error(`获取玩家档案失败 HTTP ${res.status}`);
    return res.json();
  }

  async refresh(refreshToken) {
    this.requireClientId();
    const data = await this.post(TOKEN, {
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: refreshToken,
    });
    return this.complete(data);
  }
}

/** 账号持久化：<root>/accounts.json */
export class AccountStore {
  constructor(root) {
    this.file = path.join(root, 'accounts.json');
    this.data = { selected: null, accounts: [] };
  }

  async load() {
    const data = await readJson(this.file, null);
    if (data?.accounts) this.data = data;
    return this.data;
  }

  async save() {
    await writeJson(this.file, this.data);
  }

  list() {
    return this.data.accounts.map((a) => ({
      id: a.uuid,
      name: a.name,
      type: a.type,
      selected: a.uuid === this.data.selected,
      expiresAt: a.expiresAt || null,
    }));
  }

  current() {
    return this.data.accounts.find((a) => a.uuid === this.data.selected) || this.data.accounts[0] || null;
  }

  async add(account) {
    const idx = this.data.accounts.findIndex((a) => a.uuid === account.uuid);
    if (idx >= 0) this.data.accounts[idx] = { ...this.data.accounts[idx], ...account };
    else this.data.accounts.push(account);
    this.data.selected = account.uuid;
    await this.save();
    return account;
  }

  async select(uuid) {
    this.data.selected = uuid;
    await this.save();
  }

  async remove(uuid) {
    this.data.accounts = this.data.accounts.filter((a) => a.uuid !== uuid);
    if (this.data.selected === uuid) this.data.selected = this.data.accounts[0]?.uuid || null;
    await this.save();
  }
}

/** 供 UI 轮询的登录会话管理器。 */
export class LoginSessions {
  constructor(auth) {
    this.auth = auth;
    this.sessions = new Map();
  }

  async start() {
    const code = await this.auth.startDeviceCode();
    const id = uuidV4();
    this.sessions.set(id, {
      id,
      createdAt: Date.now(),
      expiresAt: Date.now() + code.expiresIn * 1000,
      status: 'pending',
      code,
      account: null,
      error: null,
      started: false,
    });
    return { id, ...code };
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    return {
      id: s.id,
      status: s.status,
      userCode: s.code.userCode,
      verificationUri: s.code.verificationUri,
      expiresAt: s.expiresAt,
      error: s.error,
      account: s.account ? { name: s.account.name, uuid: s.account.uuid } : null,
    };
  }

  /** 后台轮询直到成功/过期；UI 只需反复 get。 */
  run(id, onAccount) {
    const s = this.sessions.get(id);
    if (!s || s.started) return;
    s.started = true;
    const loop = async () => {
      let interval = (s.code.interval || 5) * 1000;
      while (Date.now() < s.expiresAt) {
        await new Promise((r) => setTimeout(r, interval));
        try {
          const r = await this.auth.pollOnce(s.code.deviceCode);
          if (r.pending) {
            if (r.slowDown) interval += 2000;
            continue;
          }
          s.status = 'finishing';
          const account = await this.auth.complete(r.tokens);
          s.account = account;
          s.status = 'done';
          await onAccount?.(account);
          return;
        } catch (e) {
          s.status = 'error';
          s.error = e.message;
          return;
        }
      }
      s.status = 'expired';
      s.error = '设备码已过期';
    };
    loop().catch((e) => {
      s.status = 'error';
      s.error = e.message;
    });
  }

  cleanup() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.expiresAt > 10 * 60 * 1000) this.sessions.delete(id);
    }
  }
}
