package dev.mclauncher.core;

import java.util.List;
import java.util.Map;

/** 版本 JSON 的模型（字段名与 Mojang 一致，交给 Gson 反序列化）。 */
public class VersionMeta {
    public String id;
    public String type;
    public String mainClass;
    public String assets;
    public String jar;
    public String inheritsFrom;
    public String minecraftArguments;
    public List<Library> libraries;
    public Arguments arguments;
    public AssetIndex assetIndex;
    public JavaVersion javaVersion;
    public Logging logging;
    public Downloads downloads;

    public static class Library {
        public String name;
        public String url;
        public Downloads downloads;
        public Map<String, String> natives;
        public Extract extract;
        public List<Rules.Rule> rules;
    }

    public static class Downloads {
        public Artifact client;
        public Artifact server;
        public Artifact artifact;
        public Map<String, Artifact> classifiers;
    }

    public static class Artifact {
        public String path;
        public String url;
        public String sha1;
        public Long size;
    }

    public static class Arguments {
        public List<Object> game;
        public List<Object> jvm;
    }

    public static class AssetIndex {
        public String id;
        public String sha1;
        public String url;
        public Long size;
        public Long totalSize;
    }

    public static class JavaVersion {
        public Integer majorVersion;
    }

    public static class Logging {
        public LoggingClient client;
    }

    public static class LoggingClient {
        public String argument;
        public LogFile file;
    }

    public static class LogFile {
        public String id;
        public String url;
        public String sha1;
        public Long size;
    }

    public static class Extract {
        public List<String> exclude;
    }
}
