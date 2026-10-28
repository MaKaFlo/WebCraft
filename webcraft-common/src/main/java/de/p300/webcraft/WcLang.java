package de.p300.webcraft;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Names of blocks, items and mobs in another language (e.g. de_de) for the browser. Minecraft's language files
 * are only in the client's assets, so the server loads the one asked for once from Mojang ({@link WcAssets}).
 * Call from a background thread.
 */
final class WcLang {
    private static final Pattern CODE = Pattern.compile("[a-z]{2,3}_[a-z]{2,3}");

    private final WcAssets assets;
    private final boolean enabled;
    private final Map<String, JsonObject> messages = new ConcurrentHashMap<>();

    /** enabled: the server owner allows loading Mojang's files ({@code mojang-assets}), else there are no names. */
    WcLang(WcAssets assets, boolean enabled) {
        this.assets = assets;
        this.enabled = enabled;
    }

    /** The "lang" message ({t, l, names: key -> name}) for a language code, or null when it can't be had. */
    JsonObject message(String code) {
        if (!enabled || code == null || !CODE.matcher(code).matches()) return null;
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
            assets.log().warning("WebCraft: language " + code + " not available: " + e.getMessage());
            return null;
        }
    }

    /** The whole language file of the server's version. */
    private JsonObject load(String code) throws Exception {
        String hash = assets.hash("minecraft/lang/" + code + ".json");
        if (hash == null) throw new IllegalStateException("no such language");
        return JsonParser.parseString(new String(assets.file(hash), StandardCharsets.UTF_8)).getAsJsonObject();
    }
}
