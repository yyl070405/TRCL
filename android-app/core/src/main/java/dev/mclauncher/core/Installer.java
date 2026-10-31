package dev.mclauncher.core;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 根据版本 JSON 生成下载计划（client / libraries / natives）。 */
public final class Installer {
    public static final String LIBRARIES_BASE = "https://libraries.minecraft.net";
    public static final String RESOURCES_BASE = "https://resources.download.minecraft.net";

    private Installer() {
    }

    public static final class Task {
        public final String url;
        public final String dest;
        public final String sha1;
        public final long size;
        public final String kind;

        public Task(String url, String dest, String sha1, long size, String kind) {
            this.url = url;
            this.dest = dest;
            this.sha1 = sha1;
            this.size = size;
            this.kind = kind;
        }
    }

    public static List<Task> plan(VersionMeta version, VersionMeta base, String baseId, Path shared, Rules.Context ctx) {
        List<Task> tasks = new ArrayList<Task>();

        if (base.downloads != null && base.downloads.client != null && base.downloads.client.url != null) {
            VersionMeta.Artifact client = base.downloads.client;
            Path dest = shared.resolve("versions").resolve(baseId).resolve(baseId + ".jar");
            tasks.add(new Task(client.url, dest.toString(), client.sha1, sizeOf(client), "client"));
        }

        Path librariesDir = shared.resolve("libraries");
        for (VersionMeta.Library lib : Libraries.dedupe(version.libraries, ctx)) {
            String url = Libraries.artifactUrl(lib, LIBRARIES_BASE);
            Path dest = Libraries.artifactPath(lib, librariesDir);
            tasks.add(new Task(url, dest.toString(), Libraries.artifactSha1(lib), sizeOf(lib), "library"));

            Task nativeTask = nativeTask(lib, librariesDir, ctx);
            if (nativeTask != null) {
                tasks.add(nativeTask);
            }
        }
        return tasks;
    }

    static Task nativeTask(VersionMeta.Library lib, Path librariesDir, Rules.Context ctx) {
        if (lib.natives == null) {
            return null;
        }
        String raw = lib.natives.get(ctx.osName);
        if (raw == null) {
            return null;
        }
        String classifier = raw.replace("${arch}", "64");
        VersionMeta.Artifact artifact = null;
        if (lib.downloads != null && lib.downloads.classifiers != null) {
            artifact = lib.downloads.classifiers.get(classifier);
        }
        if (artifact != null && artifact.path != null) {
            return new Task(artifact.url, librariesDir.resolve(artifact.path).toString(), artifact.sha1, sizeOf(artifact), "native");
        }
        String maven = lib.name + ":" + classifier;
        Path dest = librariesDir.resolve(Maven.path(maven));
        String base = lib.url != null ? lib.url : LIBRARIES_BASE;
        return new Task(base.replaceAll("/+$", "") + "/" + Maven.path(maven), dest.toString(), null, 0, "native");
    }

    static long sizeOf(VersionMeta.Artifact artifact) {
        return artifact != null && artifact.size != null ? artifact.size : 0;
    }

    static long sizeOf(VersionMeta.Library lib) {
        return lib.downloads != null ? sizeOf(lib.downloads.artifact) : 0;
    }

    /** 从资源索引对象生成 assets 下载任务。 */
    public static List<Task> planAssets(Map<String, Map<String, Object>> objects, Path assetsDir) {
        List<Task> tasks = new ArrayList<Task>();
        for (Map.Entry<String, Map<String, Object>> e : objects.entrySet()) {
            Object hashObj = e.getValue().get("hash");
            if (hashObj == null) {
                continue;
            }
            String hash = hashObj.toString();
            String prefix = hash.substring(0, 2);
            Path dest = assetsDir.resolve("objects").resolve(prefix).resolve(hash);
            String url = RESOURCES_BASE + "/" + prefix + "/" + hash;
            Object sizeObj = e.getValue().get("size");
            long size = sizeObj instanceof Number ? ((Number) sizeObj).longValue() : 0;
            tasks.add(new Task(url, dest.toString(), hash, size, "asset"));
        }
        return tasks;
    }
}
