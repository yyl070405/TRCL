package dev.mclauncher.core;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 运行时资源清单：优先从网络下载，失败时退回“给链接 + 用户手动放文件”。
 * 资源本身不打进 APK。
 */
public final class Resources {
    private Resources() {
    }

    public static final class Component {
        public final String id;
        public final String name;
        public final String version;
        public final String kind;
        public final String sha256;
        public final long size;
        public final List<String> urls;

        public Component(String id, String name, String version, String kind, String sha256, long size, List<String> urls) {
            this.id = id;
            this.name = name;
            this.version = version;
            this.kind = kind;
            this.sha256 = sha256;
            this.size = size;
            this.urls = urls == null ? Collections.<String>emptyList() : Collections.unmodifiableList(new ArrayList<String>(urls));
        }

        /** 没有官方下载地址，只能让用户手动提供。 */
        public boolean manualOnly() {
            return urls.isEmpty();
        }
    }

    public static final String MOBILEGLUES_URL =
            "https://github.com/MobileGL-Dev/MobileGlues-release/releases/download/V2.0.0/MobileGlues_2.0.0.apk";
    public static final String JRE17_URL =
            "https://github.com/PojavLauncherTeam/android-openjdk-build-multiarch/releases/download/jre17-ca01427/jre17-arm64-20220817-release.tar.xz";

    /** 远程清单：加新运行时不用重装 APK。没部署时退回内置清单。 */
    public static final String MANIFEST_URL = "https://863214.xyz/runtime/manifest.json";

    /**
     * 解析远程清单。格式：
     * {"components":[{"id":"jre21","name":"Java 21","version":"21.0.5","kind":"tar.xz",
     *   "sha256":"...","size":123,"urls":["https://..."]}]}
     */
    public static List<Component> parseManifest(String json) {
        List<Component> list = new ArrayList<Component>();
        com.google.gson.JsonObject root = com.google.gson.JsonParser.parseString(json).getAsJsonObject();
        com.google.gson.JsonArray arr = root.has("components") ? root.getAsJsonArray("components") : null;
        if (arr == null) {
            return list;
        }
        for (com.google.gson.JsonElement el : arr) {
            com.google.gson.JsonObject o = el.getAsJsonObject();
            List<String> urls = new ArrayList<String>();
            if (o.has("urls")) {
                for (com.google.gson.JsonElement u : o.getAsJsonArray("urls")) {
                    urls.add(u.getAsString());
                }
            }
            list.add(new Component(
                    o.get("id").getAsString(),
                    o.has("name") ? o.get("name").getAsString() : o.get("id").getAsString(),
                    o.has("version") ? o.get("version").getAsString() : "",
                    o.has("kind") ? o.get("kind").getAsString() : "zip",
                    o.has("sha256") ? o.get("sha256").getAsString() : null,
                    o.has("size") ? o.get("size").getAsLong() : 0,
                    urls));
        }
        return list;
    }

    /** 拉远程清单；失败返回空列表，由调用方退回 builtin()。 */
    public static List<Component> loadRemote() {
        try {
            return parseManifest(Meta.get(MANIFEST_URL));
        } catch (Exception e) {
            return new ArrayList<Component>();
        }
    }

    /** 远程优先，内置兜底。 */
    public static List<Component> available() {
        List<Component> remote = loadRemote();
        return remote.isEmpty() ? builtin() : remote;
    }

    /** 当前可用的资源。JRE 21/25 没有公开的单独下载地址，标记为手动。 */
    public static List<Component> builtin() {
        List<Component> list = new ArrayList<Component>();
        list.add(new Component(
                "mobileglues",
                "MobileGlues",
                "2.0.0",
                "apk",
                "a7e1eb29731fdece7ab3af7fb00692b856f1808a7544436e7b3eb6c08355581a",
                11416886,
                Collections.singletonList(MOBILEGLUES_URL)));
        list.add(new Component(
                "jre17",
                "Java 17 (Android)",
                "17.0.4",
                "tar.xz",
                null,
                21057916,
                Collections.singletonList(JRE17_URL)));
        list.add(new Component(
                "jre21",
                "Java 21 (Android)",
                "21",
                "tar.xz",
                null,
                0,
                Collections.<String>emptyList()));
        return list;
    }

    public static Component byId(String id) {
        for (Component c : builtin()) {
            if (c.id.equals(id)) {
                return c;
            }
        }
        return null;
    }

    /** 国内可达的 GitHub 加速前缀；实测 gh-proxy.com 可用。 */
    public static final String[] GH_PROXIES = {
            "https://gh-proxy.com/",
    };

    /** 直链 + 各加速前缀，按可用性排序。 */
    public static List<String> expandUrls(Component component) {
        List<String> out = new ArrayList<String>();
        for (String url : component.urls) {
            if (url.startsWith("https://github.com/")) {
                for (String proxy : GH_PROXIES) {
                    out.add(proxy + url);
                }
            }
            out.add(url);
        }
        return out;
    }

    /** 依次尝试清单里的地址，返回第一个可达的。 */
    public static String pickUrl(Component component) throws IOException {
        if (component.manualOnly()) {
            throw new IOException("该资源没有官方下载地址，请手动下载后放入 runtime/" + component.id);
        }
        IOException last = null;
        for (String url : expandUrls(component)) {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("HEAD");
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(12000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "MCLauncher/0.1");
                int code = conn.getResponseCode();
                long len = conn.getContentLengthLong();
                conn.disconnect();
                if (code == 200 && len != 0) {
                    return url;
                }
                last = new IOException("HTTP " + code + " " + url);
            } catch (IOException e) {
                last = e;
            }
        }
        throw last == null ? new IOException("没有可用下载地址") : last;
    }

    /** 给 UI 的兜底信息：链接列表 + 手动放置路径。 */
    public static String manualHelp(Component component) {
        StringBuilder sb = new StringBuilder();
        sb.append(component.name).append(" ").append(component.version).append("\n");
        if (component.manualOnly()) {
            sb.append("没有官方直链，请从官方发布页或已安装的运行时中提取。\n");
        } else {
            sb.append("下载地址（任选一个）：\n");
            for (String u : expandUrls(component)) {
                sb.append(u).append("\n");
            }
        }
        sb.append("手动放置：Android/data/<包名>/files/runtime/").append(component.id).append("/");
        return sb.toString();
    }
}
