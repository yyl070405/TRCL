package dev.mclauncher.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public final class Json {
    public static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private Json() {
    }

    public static String read(Path file) throws IOException {
        return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
    }

    public static <T> T read(Path file, Class<T> type) throws IOException {
        return GSON.fromJson(read(file), type);
    }

    /** 读成 JsonObject，需要按字段递归合并版本 JSON 时用。 */
    public static com.google.gson.JsonObject readJson(Path file) throws IOException {
        return com.google.gson.JsonParser.parseString(read(file)).getAsJsonObject();
    }

    public static void write(Path file, Object value) throws IOException {
        if (file.getParent() != null) {
            Files.createDirectories(file.getParent());
        }
        Files.write(file, GSON.toJson(value).getBytes(StandardCharsets.UTF_8));
    }

    public static List<Rules.Rule> rules(Object raw) {
        if (raw == null) {
            return null;
        }
        return GSON.fromJson(GSON.toJsonTree(raw), new TypeToken<List<Rules.Rule>>() {
        }.getType());
    }
}
