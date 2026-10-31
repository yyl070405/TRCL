package dev.mclauncher.core;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 库列表处理：规则过滤、按坐标去重、路径解析。 */
public final class Libraries {
    private Libraries() {
    }

    /** 同一 group:artifact:classifier 只保留最后出现的版本（加载器覆盖原版）。 */
    public static List<VersionMeta.Library> dedupe(List<VersionMeta.Library> libs, Rules.Context ctx) {
        Map<String, VersionMeta.Library> map = new LinkedHashMap<String, VersionMeta.Library>();
        if (libs == null) {
            return new ArrayList<VersionMeta.Library>();
        }
        for (VersionMeta.Library lib : libs) {
            if (lib == null || lib.name == null) {
                continue;
            }
            if (!Rules.matches(lib.rules, ctx)) {
                continue;
            }
            String name = lib.name;
            int at = name.indexOf('@');
            if (at >= 0) {
                name = name.substring(0, at);
            }
            String[] coords = name.split(":");
            if (coords.length < 3) {
                continue;
            }
            String classifier = coords.length > 3 ? coords[3] : "";
            map.put(coords[0] + ":" + coords[1] + ":" + classifier, lib);
        }
        return new ArrayList<VersionMeta.Library>(map.values());
    }

    public static Path artifactPath(VersionMeta.Library lib, Path librariesDir) {
        VersionMeta.Artifact artifact = lib.downloads != null ? lib.downloads.artifact : null;
        if (artifact != null && artifact.path != null) {
            return librariesDir.resolve(artifact.path);
        }
        return librariesDir.resolve(Maven.path(lib.name));
    }

    public static String artifactUrl(VersionMeta.Library lib, String defaultBase) {
        VersionMeta.Artifact artifact = lib.downloads != null ? lib.downloads.artifact : null;
        if (artifact != null && artifact.url != null) {
            return artifact.url;
        }
        String base = lib.url != null ? lib.url : defaultBase;
        return base.replaceAll("/+$", "") + "/" + Maven.path(lib.name);
    }

    public static String artifactSha1(VersionMeta.Library lib) {
        return lib.downloads != null && lib.downloads.artifact != null ? lib.downloads.artifact.sha1 : null;
    }

    public static Long artifactSize(VersionMeta.Library lib) {
        return lib.downloads != null && lib.downloads.artifact != null ? lib.downloads.artifact.size : null;
    }
}
