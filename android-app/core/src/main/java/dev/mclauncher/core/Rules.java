package dev.mclauncher.core;

import java.util.List;
import java.util.Map;

/** Mojang 规则引擎：os / arch / version / features。 */
public final class Rules {
    private Rules() {
    }

    public static final class Rule {
        public String action;
        public Os os;
        public Map<String, Boolean> features;
    }

    public static final class Os {
        public String name;
        public String arch;
        public String version;
    }

    public static final class Context {
        public final String osName;
        public final String osArch;
        public final String osVersion;
        public final Map<String, Boolean> features;

        public Context(String osName, String osArch, String osVersion, Map<String, Boolean> features) {
            this.osName = osName;
            this.osArch = osArch;
            this.osVersion = osVersion;
            this.features = features;
        }

        /** Android 上 JVM 报告的是 Linux，所以规则要按 linux 匹配。 */
        public static Context android() {
            java.util.HashMap<String, Boolean> features = new java.util.HashMap<String, Boolean>();
            features.put("has_custom_resolution", true);
            features.put("is_demo_user", false);
            features.put("has_quick_plays_support", false);
            return new Context("linux", "arm64", "Android", features);
        }
    }

    public static boolean matches(List<Rule> rules, Context ctx) {
        if (rules == null || rules.isEmpty()) {
            return true;
        }
        boolean allowed = false;
        for (Rule rule : rules) {
            if (!ruleMatches(rule, ctx)) {
                continue;
            }
            allowed = "allow".equals(rule.action);
        }
        return allowed;
    }

    private static boolean ruleMatches(Rule rule, Context ctx) {
        if (rule.os != null) {
            if (rule.os.name != null && !rule.os.name.equals(ctx.osName)) {
                return false;
            }
            if (rule.os.arch != null && !rule.os.arch.equals(ctx.osArch)) {
                return false;
            }
            if (rule.os.version != null && !ctx.osVersion.matches(rule.os.version)) {
                return false;
            }
        }
        if (rule.features != null) {
            for (Map.Entry<String, Boolean> e : rule.features.entrySet()) {
                boolean actual = Boolean.TRUE.equals(ctx.features.get(e.getKey()));
                if (actual != Boolean.TRUE.equals(e.getValue())) {
                    return false;
                }
            }
        }
        return true;
    }
}
