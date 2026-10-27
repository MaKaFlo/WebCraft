package de.p300.webcraft;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.authlib.GameProfile;
import com.mojang.authlib.properties.Property;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Skins: a WebCraft player may wear the skin of a Minecraft account. Mojang signs the "textures" property
 * of every account, so the fake player's profile carries it and normal Minecraft clients show the skin too.
 * The browser gets skin pictures through the server (textures.minecraft.net sends no CORS headers).
 * Everything that talks to Mojang blocks: call it off the main thread.
 */
final class WcSkins {

    static final Pattern MC_NAME = Pattern.compile("[A-Za-z0-9_]{1,16}");
    private static final Pattern HASH = Pattern.compile("[0-9a-f]{20,80}");
    private static final long KEEP_MS = 6L * 60 * 60 * 1000;   // look the account up again after 6 hours

    private final Path folder;
    private final Logger log;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .proxy(java.net.ProxySelector.getDefault())   // https.proxyHost of the server, if any
            .followRedirects(HttpClient.Redirect.NORMAL).build();
    private final Map<String, Property> byName = new ConcurrentHashMap<>();
    private final Map<String, Long> fetchedAt = new ConcurrentHashMap<>();
    private final Map<String, String[]> hashOfValue = new ConcurrentHashMap<>();

    WcSkins(Path folder, Logger log) {
        this.folder = folder;
        this.log = log;
    }

    /** Signed "textures" property of a Minecraft account, or null (unknown name, Mojang not reachable). */
    Property lookup(String mcName) {
        if (mcName == null || !MC_NAME.matcher(mcName).matches()) return null;
        String key = mcName.toLowerCase();
        Property known = byName.get(key);
        Long at = fetchedAt.get(key);
        if (known != null && at != null && System.currentTimeMillis() - at < KEEP_MS) return known;
        Path file = folder.resolve("profiles").resolve(key + ".json");
        try {
            JsonObject id = get("https://api.mojang.com/users/profiles/minecraft/" + mcName);
            if (id == null || !id.has("id")) return known != null ? known : readCached(file);
            JsonObject profile = get("https://sessionserver.mojang.com/session/minecraft/profile/"
                    + id.get("id").getAsString() + "?unsigned=false");
            if (profile == null || !profile.has("properties")) return known != null ? known : readCached(file);
            for (JsonElement el : profile.getAsJsonArray("properties")) {
                JsonObject p = el.getAsJsonObject();
                if (!"textures".equals(p.get("name").getAsString())) continue;
                Property prop = new Property("textures", p.get("value").getAsString(),
                        p.has("signature") ? p.get("signature").getAsString() : null);
                byName.put(key, prop);
                fetchedAt.put(key, System.currentTimeMillis());
                Files.createDirectories(file.getParent());
                Files.writeString(file, p.toString());
                return prop;
            }
        } catch (Exception e) {
            log.warning("WebCraft: skin of " + mcName + " not available: " + e.getMessage());
            Property cached = known != null ? known : readCached(file);
            if (cached != null) byName.put(key, cached);
            return cached;
        }
        return null;
    }

    /** Last answer from Mojang saved on disk (when Mojang is not reachable). */
    private Property readCached(Path file) {
        try {
            if (!Files.exists(file)) return null;
            JsonObject p = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            return new Property("textures", p.get("value").getAsString(),
                    p.has("signature") ? p.get("signature").getAsString() : null);
        } catch (Exception e) {
            return null;
        }
    }

    /** {texture hash, "slim" or ""} of a profile's skin, or null (no skin: Steve). */
    String[] skinOf(GameProfile profile) {
        if (profile == null) return null;
        var props = profile.properties().get("textures");
        if (props == null || props.isEmpty()) return null;
        String[] skin = hashOfValue.computeIfAbsent(props.iterator().next().value(), WcSkins::decode);
        return skin.length == 2 ? skin : null;
    }

    /** Texture hash and model from the base64 "textures" value; empty when there is no usable skin. */
    private static String[] decode(String value) {
        try {
            JsonObject tex = JsonParser.parseString(new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8))
                    .getAsJsonObject().getAsJsonObject("textures");
            if (tex == null || !tex.has("SKIN")) return new String[0];
            JsonObject skin = tex.getAsJsonObject("SKIN");
            String url = skin.get("url").getAsString();
            String hash = url.substring(url.lastIndexOf('/') + 1);
            boolean slim = skin.has("metadata") && "slim".equals(skin.getAsJsonObject("metadata").get("model").getAsString());
            return HASH.matcher(hash).matches() ? new String[] {hash, slim ? "slim" : ""} : new String[0];
        } catch (Exception e) {
            return new String[0];
        }
    }

    /** Adds "skin" (texture hash) and "slim" to a player's entity JSON. */
    void addTo(JsonObject o, GameProfile profile) {
        String[] skin = skinOf(profile);
        if (skin == null) return;
        o.addProperty("skin", skin[0]);
        if (!skin[1].isEmpty()) o.addProperty("slim", true);
    }

    /** Profile of a WebCraft player: with the signed skin of the chosen account, when there is one. */
    static GameProfile profile(java.util.UUID id, String name, Property skin) {
        if (skin == null) return new GameProfile(id, name);
        return new GameProfile(id, name, new com.mojang.authlib.properties.PropertyMap(
                com.google.common.collect.ImmutableMultimap.of("textures", skin)));
    }

    /** The skin picture (PNG) for a texture hash, from the disk cache or textures.minecraft.net; null on failure. */
    byte[] picture(String hash) {
        if (hash == null || !HASH.matcher(hash).matches()) return null;
        Path file = folder.resolve(hash + ".png");
        try {
            if (Files.exists(file)) return Files.readAllBytes(file);
            HttpResponse<byte[]> r = http.send(HttpRequest.newBuilder(URI.create("https://textures.minecraft.net/texture/" + hash))
                    .timeout(Duration.ofSeconds(10)).build(), HttpResponse.BodyHandlers.ofByteArray());
            if (r.statusCode() != 200 || r.body().length > 64 * 1024) return null;
            Files.createDirectories(folder);
            Files.write(file, r.body());
            return r.body();
        } catch (Exception e) {
            log.warning("WebCraft: skin picture " + hash + " not available: " + e.getMessage());
            return null;
        }
    }

    /** `skin` answer for the browser. */
    JsonObject message(String hash, byte[] png) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "skin");
        m.addProperty("h", hash);
        if (png != null) m.addProperty("png", Base64.getEncoder().encodeToString(png));
        return m;
    }

    private JsonObject get(String url) throws Exception {
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8)).build(),
                HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) return null;
        return JsonParser.parseString(r.body()).getAsJsonObject();
    }
}
