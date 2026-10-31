package dev.mclauncher.core;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** 版本清单与版本 JSON 的拉取/缓存。 */
public final class Meta {
    public static final String MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

    private Meta() {
    }

    public static final class Manifest {
        public Latest latest;
        public List<Entry> versions;
    }

    public static final class Latest {
        public String release;
        public String snapshot;
    }

    public static final class Entry {
        public String id;
        public String type;
        public String url;
        public String releaseTime;
    }

    public static String get(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", "TRCL/0.1 (+https://github.com/yyl070405/TRCL)");
        int code = conn.getResponseCode();
        if (code != 200) {
            conn.disconnect();
            throw new IOException("HTTP " + code + " " + url);
        }
        InputStream in = conn.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        try {
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        } finally {
            in.close();
            conn.disconnect();
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    public static Manifest manifest() throws IOException {
        return Json.GSON.fromJson(get(MANIFEST_URL), Manifest.class);
    }

    public static Entry find(Manifest manifest, String id) {
        if (manifest == null || manifest.versions == null) {
            return null;
        }
        for (Entry e : manifest.versions) {
            if (id.equals(e.id)) {
                return e;
            }
        }
        return null;
    }

    /** 读取本地版本 JSON，没有就按 URL 下载并落盘。 */
    public static VersionMeta version(Path versionsDir, String id, String url) throws IOException {
        Path dir = versionsDir.resolve(id);
        Path file = dir.resolve(id + ".json");
        if (Files.isRegularFile(file)) {
            return Json.read(file, VersionMeta.class);
        }
        VersionMeta meta = Json.GSON.fromJson(get(url), VersionMeta.class);
        Json.write(file, meta);
        return meta;
    }
}
