package dev.mclauncher.core;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * 微软设备码登录：
 * Microsoft OAuth -> Xbox Live -> XSTS -> Minecraft Services -> profile。
 */
public final class MicrosoftAuth {
    private static final String DEVICE_CODE = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
    private static final String TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
    private static final String XBL = "https://user.auth.xboxlive.com/user/authenticate";
    private static final String XSTS = "https://xsts.auth.xboxlive.com/xsts/authorize";
    private static final String MC_LOGIN = "https://api.minecraftservices.com/authentication/login_with_xbox";
    private static final String MC_PROFILE = "https://api.minecraftservices.com/minecraft/profile";
    private static final String SCOPE = "XboxLive.signin offline_access";

    private final String clientId;

    public MicrosoftAuth(String clientId) {
        this.clientId = clientId == null ? "" : clientId.trim();
    }

    public static final class DeviceCode {
        public String deviceCode;
        public String userCode;
        public String verificationUri;
        public int expiresIn;
        public int interval;
        public String message;
    }

    public static final class Tokens {
        public String accessToken;
        public String refreshToken;
    }

    public static final class PollResult {
        public boolean pending;
        public boolean slowDown;
        public Tokens tokens;
    }

    public static final class Account {
        public String type = "msa";
        public String name;
        public String uuid;
        public String accessToken;
        public String refreshToken;
        public long expiresAt;
        public String xuid;
    }

    private void requireClientId() {
        if (clientId.isEmpty()) {
            throw new IllegalStateException("未配置微软 client id");
        }
    }

    public DeviceCode start() throws IOException {
        requireClientId();
        Map<String, String> form = new HashMap<String, String>();
        form.put("client_id", clientId);
        form.put("scope", SCOPE);
        JsonObject json = JsonParser.parseString(Http.postForm(DEVICE_CODE, form)).getAsJsonObject();
        DeviceCode dc = new DeviceCode();
        dc.deviceCode = json.get("device_code").getAsString();
        dc.userCode = json.get("user_code").getAsString();
        dc.verificationUri = json.get("verification_uri").getAsString();
        dc.expiresIn = json.has("expires_in") ? json.get("expires_in").getAsInt() : 900;
        dc.interval = json.has("interval") ? json.get("interval").getAsInt() : 5;
        dc.message = json.has("message") ? json.get("message").getAsString() : "";
        return dc;
    }

    public PollResult poll(DeviceCode dc) throws IOException {
        requireClientId();
        Map<String, String> form = new HashMap<String, String>();
        form.put("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
        form.put("client_id", clientId);
        form.put("device_code", dc.deviceCode);
        try {
            JsonObject json = JsonParser.parseString(Http.postForm(TOKEN, form)).getAsJsonObject();
            PollResult r = new PollResult();
            r.tokens = new Tokens();
            r.tokens.accessToken = json.get("access_token").getAsString();
            r.tokens.refreshToken = json.has("refresh_token") ? json.get("refresh_token").getAsString() : null;
            return r;
        } catch (Http.HttpException e) {
            String code = "";
            String desc = "";
            try {
                JsonObject err = JsonParser.parseString(e.body).getAsJsonObject();
                code = err.has("error") ? err.get("error").getAsString() : "";
                desc = err.has("error_description") ? err.get("error_description").getAsString() : "";
            } catch (Exception ignored) {
            }
            PollResult r = new PollResult();
            if ("authorization_pending".equals(code) || "slow_down".equals(code)) {
                r.pending = true;
                r.slowDown = "slow_down".equals(code);
                return r;
            }
            if ("expired_token".equals(code)) {
                throw new IOException("设备码已过期，请重新登录");
            }
            if ("authorization_declined".equals(code)) {
                throw new IOException("已取消登录授权");
            }
            throw new IOException("登录失败: " + (desc.isEmpty() ? code : desc));
        }
    }

    public Account complete(Tokens tokens) throws IOException {
        String xblBody = "{\"Properties\":{\"AuthMethod\":\"RPS\",\"SiteName\":\"user.auth.xboxlive.com\","
                + "\"RpsTicket\":\"d=" + escape(tokens.accessToken) + "\"},"
                + "\"RelyingParty\":\"http://auth.xboxlive.com\",\"TokenType\":\"JWT\"}";
        JsonObject xbl = JsonParser.parseString(Http.postJson(XBL, xblBody, null)).getAsJsonObject();
        String xblToken = xbl.get("Token").getAsString();
        String uhs = xbl.getAsJsonObject("DisplayClaims").getAsJsonArray("xui").get(0).getAsJsonObject()
                .get("uhs").getAsString();

        String xstsBody = "{\"Properties\":{\"SandboxId\":\"RETAIL\",\"UserTokens\":[\"" + escape(xblToken) + "\"]},"
                + "\"RelyingParty\":\"rp://api.minecraftservices.com/\",\"TokenType\":\"JWT\"}";
        String xstsToken;
        try {
            xstsToken = JsonParser.parseString(Http.postJson(XSTS, xstsBody, null)).getAsJsonObject()
                    .get("Token").getAsString();
        } catch (Http.HttpException e) {
            throw new IOException(xstsMessage(e.body));
        }

        String mcBody = "{\"identityToken\":\"XBL3.0 x=" + escape(uhs) + ";" + escape(xstsToken) + "\"}";
        JsonObject mc = JsonParser.parseString(Http.postJson(MC_LOGIN, mcBody, null)).getAsJsonObject();
        String accessToken = mc.get("access_token").getAsString();
        long expiresIn = mc.has("expires_in") ? mc.get("expires_in").getAsLong() : 86400;

        JsonObject profile;
        try {
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Authorization", "Bearer " + accessToken);
            profile = JsonParser.parseString(Http.get(MC_PROFILE, headers)).getAsJsonObject();
        } catch (Http.HttpException e) {
            if (e.status == 404) {
                throw new IOException("该账号没有购买 Minecraft: Java 版");
            }
            throw new IOException("获取玩家档案失败: HTTP " + e.status);
        }

        Account account = new Account();
        account.name = profile.get("name").getAsString();
        account.uuid = profile.get("id").getAsString();
        account.accessToken = accessToken;
        account.refreshToken = tokens.refreshToken;
        account.expiresAt = System.currentTimeMillis() + expiresIn * 1000L;
        account.xuid = profile.has("xuid") ? profile.get("xuid").getAsString() : null;
        return account;
    }

    public Account refresh(String refreshToken) throws IOException {
        requireClientId();
        Map<String, String> form = new HashMap<String, String>();
        form.put("grant_type", "refresh_token");
        form.put("client_id", clientId);
        form.put("refresh_token", refreshToken);
        JsonObject json = JsonParser.parseString(Http.postForm(TOKEN, form)).getAsJsonObject();
        Tokens tokens = new Tokens();
        tokens.accessToken = json.get("access_token").getAsString();
        tokens.refreshToken = json.has("refresh_token") ? json.get("refresh_token").getAsString() : refreshToken;
        return complete(tokens);
    }

    static String xstsMessage(String body) {
        String xerr = "";
        try {
            JsonObject err = JsonParser.parseString(body).getAsJsonObject();
            if (err.has("XErr")) {
                xerr = err.get("XErr").getAsString();
            }
        } catch (Exception ignored) {
        }
        if ("2148916233".equals(xerr)) {
            return "该微软账号没有 Xbox 账号，请先在 xbox.com 创建";
        }
        if ("2148916235".equals(xerr)) {
            return "该账号所在地区不支持 Xbox Live";
        }
        if ("2148916238".equals(xerr)) {
            return "未成年账号需要先加入家庭组";
        }
        return "Xbox 认证失败 (XErr=" + (xerr.isEmpty() ? "未知" : xerr) + ")";
    }

    private static String escape(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') {
                sb.append('\\');
            }
            sb.append(c);
        }
        return sb.toString();
    }
}
