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
import java.util.logging.Logger;

/**
 * Minecraft's client assets (language files, sounds) for the server's version, loaded from Mojang once
 * (version manifest -> asset index -> resources.download.minecraft.net) and kept in a cache folder by hash.
 * Not in the repo and not in the server jar: only Mojang's own download. Call from background threads.
 */
final class WcAssets {
    private static final String MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

    final String version = net.minecraft.SharedConstants.getCurrentVersion().id();
    private final Path folder;
    private final Logger log;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .proxy(java.net.ProxySelector.getDefault())
            .followRedirects(HttpClient.Redirect.NORMAL).build();
    private volatile JsonObject objects;

    WcAssets(Path folder, Logger log) {
        this.folder = folder;
        this.log = log;
    }

    /** The asset index of this version: path ("minecraft/sounds/dig/stone1.ogg") -> {hash, size}. */
    JsonObject objects() throws Exception {
        JsonObject o = objects;
        if (o != null) return o;
        synchronized (this) {
            if (objects != null) return objects;
            Path file = folder.resolve(version + "-index.json");
            String text;
            if (Files.isRegularFile(file)) {
                text = Files.readString(file);
            } else {
                JsonObject manifest = JsonParser.parseString(new String(get(MANIFEST), StandardCharsets.UTF_8)).getAsJsonObject();
                String versionUrl = null;
                for (var v : manifest.getAsJsonArray("versions")) {
                    if (version.equals(v.getAsJsonObject().get("id").getAsString())) versionUrl = v.getAsJsonObject().get("url").getAsString();
                }
                if (versionUrl == null) throw new IllegalStateException("version " + version + " not in Mojang's list");
                String indexUrl = JsonParser.parseString(new String(get(versionUrl), StandardCharsets.UTF_8)).getAsJsonObject()
                        .getAsJsonObject("assetIndex").get("url").getAsString();
                text = new String(get(indexUrl), StandardCharsets.UTF_8);
                Files.createDirectories(folder);
                Files.writeString(file, text, StandardCharsets.UTF_8);
            }
            objects = JsonParser.parseString(text).getAsJsonObject().getAsJsonObject("objects");
            return objects;
        }
    }

    /** Hash of an asset path, or null when the version has no such file. */
    String hash(String path) throws Exception {
        JsonObject entry = objects().getAsJsonObject(path);
        return entry == null ? null : entry.get("hash").getAsString();
    }

    /** An asset file by its hash: from the cache folder, else from Mojang (then saved there). */
    byte[] file(String hash) throws Exception {
        if (!hash.matches("[0-9a-f]{40}")) throw new IllegalArgumentException("bad hash");
        Path file = folder.resolve("objects").resolve(hash.substring(0, 2)).resolve(hash);
        if (Files.isRegularFile(file)) return Files.readAllBytes(file);
        byte[] data = get("https://resources.download.minecraft.net/" + hash.substring(0, 2) + "/" + hash);
        Files.createDirectories(file.getParent());
        Path tmp = file.resolveSibling(hash + ".tmp" + Thread.currentThread().threadId());
        Files.write(tmp, data);
        Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        return data;
    }

    Logger log() {
        return log;
    }

    private byte[] get(String url) throws Exception {
        HttpResponse<byte[]> r = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30)).build(),
                HttpResponse.BodyHandlers.ofByteArray());
        if (r.statusCode() != 200) throw new IllegalStateException("HTTP " + r.statusCode() + " for " + url);
        return r.body();
    }
}
