package de.p300.webcraft;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Names of blocks, items and mobs in another language (e.g. de_de) for the browser. Minecraft's language files
 * are only in the client's assets, so the server loads the one asked for once from Mojang (version manifest ->
 * asset index -> file) and keeps it in {@code plugins/WebCraft/lang/}. Call from a background thread.
 */
final class WcLang {
    private static final Pattern CODE = Pattern.compile("[a-z]{2,3}_[a-z]{2,3}");
    private static final String MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

    private final Path folder;
    private final Logger log;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .proxy(java.net.ProxySelector.getDefault())
            .followRedirects(HttpClient.Redirect.NORMAL).build();
    private final Map<String, JsonObject> messages = new ConcurrentHashMap<>();

    WcLang(Path folder, Logger log) {
        this.folder = folder;
        this.log = log;
    }

    /** The "lang" message ({t, l, names: key -> name}) for a language code, or null when it can't be had. */
    JsonObject message(String code) {
        if (code == null || !CODE.matcher(code).matches()) return null;
        JsonObject cached = messages.get(code);
        if (cached != null) return cached;
        try {
            JsonObject all = load(code);
            if (all == null) return null;
            // Mobs first, then blocks, items win (the same key: a spawn egg is not a mob, a minecart item is fine)
            JsonObject names = new JsonObject();
            for (String prefix : new String[] {"entity.minecraft.", "block.minecraft.", "item.minecraft."}) {
                for (var e : all.entrySet()) {
                    String k = e.getKey();
                    if (!k.startsWith(prefix)) continue;
                    String key = k.substring(prefix.length());
                    if (key.contains(".")) continue;   // descriptions, effects of potions ...
                    names.addProperty(key, e.getValue().getAsString());
                }
            }
            JsonObject m = new JsonObject();
            m.addProperty("t", "lang");
            m.addProperty("l", code);
            m.add("names", names);
            messages.put(code, m);
            return m;
        } catch (Exception e) {
            log.warning("WebCraft: language " + code + " not available: " + e.getMessage());
            return null;
        }
    }

    /** The whole language file: from the cache folder, else from Mojang (then saved there). */
    private JsonObject load(String code) throws Exception {
        String version = net.minecraft.SharedConstants.getCurrentVersion().id();
        Path file = folder.resolve(version + "-" + code + ".json");
        if (Files.isRegularFile(file)) return JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        JsonObject manifest = JsonParser.parseString(get(MANIFEST)).getAsJsonObject();
        String versionUrl = null;
        for (var v : manifest.getAsJsonArray("versions")) {
            if (version.equals(v.getAsJsonObject().get("id").getAsString())) versionUrl = v.getAsJsonObject().get("url").getAsString();
        }
        if (versionUrl == null) throw new IllegalStateException("version " + version + " not in Mojang's list");
        String indexUrl = JsonParser.parseString(get(versionUrl)).getAsJsonObject().getAsJsonObject("assetIndex").get("url").getAsString();
        JsonObject objects = JsonParser.parseString(get(indexUrl)).getAsJsonObject().getAsJsonObject("objects");
        JsonObject entry = objects.getAsJsonObject("minecraft/lang/" + code + ".json");
        if (entry == null) throw new IllegalStateException("no such language");
        String hash = entry.get("hash").getAsString();
        String text = get("https://resources.download.minecraft.net/" + hash.substring(0, 2) + "/" + hash);
        JsonObject all = JsonParser.parseString(text).getAsJsonObject();
        Files.createDirectories(folder);
        Files.writeString(file, text, StandardCharsets.UTF_8);
        log.info("WebCraft: language " + code + " loaded from Mojang (" + all.size() + " texts)");
        return all;
    }

    private String get(String url) throws Exception {
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15)).build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (r.statusCode() != 200) throw new IllegalStateException("HTTP " + r.statusCode() + " for " + url);
        return r.body();
    }
}
