package de.p300.webcraft;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Renamed WebCraft accounts. A WebCraft player's UUID comes from the name ("OfflinePlayer:wc_max"); after a rename
 * the account keeps the UUID it had, like a Minecraft name change, so the player data and everything plugins store
 * per UUID (money, homes, permissions ...) stay. Stored in {@code renames.json}: {@code uuids} = account (lower
 * case, with prefix) -> UUID, {@code last} = UUID -> time of the last rename (for the waiting time).
 * The old name stays blocked for others while its UUID belongs to the renamed account.
 */
public final class WcRenames {

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private final Path file;
    private final Logger log;
    private final Map<String, UUID> uuids = new HashMap<>();
    private final Map<UUID, Long> last = new HashMap<>();

    public WcRenames(Path file, Logger log) {
        this.file = file;
        this.log = log;
        load();
    }

    private static String key(String account) {
        return account.toLowerCase(Locale.ROOT);
    }

    /** The UUID a name gets without a rename (like an offline-mode server). */
    public static UUID offline(String name) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
    }

    /** The UUID an account (with prefix) plays with: the kept one after a rename, else the one from its name. */
    public synchronized UUID uuidOf(String account) {
        UUID u = uuids.get(key(account));
        return u != null ? u : offline(account);
    }

    public synchronized boolean renamed(String account) {
        return uuids.containsKey(key(account));
    }

    /**
     * The renamed account that owns the UUID of this name now (its old name), or null. Such a name can't log in or
     * be taken: it would get the other player's data.
     */
    public synchronized String takenBy(String account) {
        if (uuids.containsKey(key(account))) return null;
        UUID u = offline(account);
        for (var e : uuids.entrySet()) if (e.getValue().equals(u)) return e.getKey();
        return null;
    }

    /** When the player with this UUID was renamed last (ms), 0 = never. */
    public synchronized long lastRename(UUID uuid) {
        return last.getOrDefault(uuid, 0L);
    }

    /** Records a rename: the new account keeps {@code uuid}. */
    public synchronized void moved(String oldAccount, String newAccount, UUID uuid) {
        uuids.remove(key(oldAccount));
        // Back to the name the UUID came from: no entry needed any more
        if (!uuid.equals(offline(newAccount))) uuids.put(key(newAccount), uuid);
        else uuids.remove(key(newAccount));
        last.put(uuid, System.currentTimeMillis());
        save();
    }

    private void load() {
        if (!Files.exists(file)) return;
        try {
            JsonObject o = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), JsonObject.class);
            if (o == null) return;
            JsonObject u = o.getAsJsonObject("uuids"), l = o.getAsJsonObject("last");
            if (u != null) for (var e : u.entrySet()) uuids.put(key(e.getKey()), UUID.fromString(e.getValue().getAsString()));
            if (l != null) for (var e : l.entrySet()) last.put(UUID.fromString(e.getKey()), e.getValue().getAsLong());
        } catch (Exception e) {
            log.log(Level.WARNING, "Could not read " + file, e);
        }
    }

    private void save() {
        JsonObject o = new JsonObject(), u = new JsonObject(), l = new JsonObject();
        for (var e : uuids.entrySet()) u.addProperty(e.getKey(), e.getValue().toString());
        for (var e : last.entrySet()) l.addProperty(e.getKey().toString(), e.getValue());
        o.add("uuids", u);
        o.add("last", l);
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, GSON.toJson(o), StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.log(Level.WARNING, "Could not write " + file, e);
        }
    }
}
