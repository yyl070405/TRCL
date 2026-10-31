package dev.mclauncher.core;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 资源索引解析与下载计划。 */
public final class Assets {
    public static final String RESOURCES_BASE = "https://resources.download.minecraft.net";

    private Assets() {
    }

    public static final class Index {
        public Map<String, Obj> objects;
    }

    public static final class Obj {
        public String hash;
        public Long size;
    }

    public static Index load(Path indexFile) throws Exception {
        return Json.read(indexFile, Index.class);
    }

    public static List<Installer.Task> plan(Index index, Path assetsDir) {
        List<Installer.Task> tasks = new ArrayList<Installer.Task>();
        if (index == null || index.objects == null) {
            return tasks;
        }
        for (Map.Entry<String, Obj> e : index.objects.entrySet()) {
            Obj obj = e.getValue();
            if (obj == null || obj.hash == null) {
                continue;
            }
            String hash = obj.hash;
            String prefix = hash.substring(0, 2);
            Path dest = assetsDir.resolve("objects").resolve(prefix).resolve(hash);
            long size = obj.size == null ? 0 : obj.size;
            tasks.add(new Installer.Task(RESOURCES_BASE + "/" + prefix + "/" + hash, dest.toString(), hash, size, "asset"));
        }
        return tasks;
    }

    /** 资源索引本身的下载任务。 */
    public static Installer.Task indexTask(VersionMeta.AssetIndex index, Path assetsDir) {
        if (index == null || index.url == null) {
            return null;
        }
        Path dest = assetsDir.resolve("indexes").resolve(index.id + ".json");
        long size = index.size == null ? 0 : index.size;
        return new Installer.Task(index.url, dest.toString(), index.sha1, size, "asset-index");
    }
}
