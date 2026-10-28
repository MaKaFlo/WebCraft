package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.core.BlockPos;
import net.minecraft.network.protocol.game.ClientboundLevelEventPacket;
import net.minecraft.network.protocol.game.ClientboundSoundEntityPacket;
import net.minecraft.network.protocol.game.ClientboundSoundPacket;
import net.minecraft.network.protocol.game.ClientboundTakeItemEntityPacket;
import net.minecraft.sounds.SoundEvent;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Minecraft's sounds for the browser.
 * <ul>
 * <li>Every tick the sounds the server sends the fake player become one `snd` message:
 *     list of [event, x, y, z, volume, pitch] or [event, "e", entityId, volume, pitch] (sound follows a mob),
 *     ["take", itemEntityId] (pickup, the browser plays it like the vanilla client).</li>
 * <li>`sound` {e}: which files belong to an event (from Minecraft's sounds.json): `sound` {e, v: [[hash, weight,
 *     volume, pitch, stream, attenuation]]}.</li>
 * <li>`sfile` {h}: one .ogg as a binary message: byte 2, 40 bytes hash, the file.</li>
 * </ul>
 * The files come from Mojang ({@link WcAssets}), they are not in the repo.
 */
final class WcSounds {
    private static final int MAX_PER_TICK = 60;

    /** Level events whose sound the vanilla client makes itself: event -> [sound, volume, pitch]. */
    private static final Map<Integer, Object[]> EVENTS = Map.ofEntries(
            Map.entry(1000, new Object[] {"block.dispenser.dispense", 1f, 1f}),
            Map.entry(1001, new Object[] {"block.dispenser.fail", 1f, 1.2f}),
            Map.entry(1002, new Object[] {"block.dispenser.launch", 1f, 1.2f}),
            Map.entry(1004, new Object[] {"entity.firework_rocket.shoot", 1f, 1.2f}),
            Map.entry(1009, new Object[] {"block.fire.extinguish", 0.5f, 2.6f}),
            Map.entry(1015, new Object[] {"entity.ghast.warn", 10f, 1f}),
            Map.entry(1016, new Object[] {"entity.ghast.shoot", 10f, 1f}),
            Map.entry(1017, new Object[] {"entity.ender_dragon.shoot", 10f, 1f}),
            Map.entry(1018, new Object[] {"entity.blaze.shoot", 2f, 1f}),
            Map.entry(1019, new Object[] {"entity.zombie.attack_wooden_door", 2f, 1f}),
            Map.entry(1020, new Object[] {"entity.zombie.attack_iron_door", 2f, 1f}),
            Map.entry(1021, new Object[] {"entity.zombie.break_wooden_door", 2f, 1f}),
            Map.entry(1022, new Object[] {"entity.wither.break_block", 2f, 1f}),
            Map.entry(1023, new Object[] {"entity.wither.spawn", 10000f, 1f}),
            Map.entry(1024, new Object[] {"entity.wither.shoot", 2f, 1f}),
            Map.entry(1025, new Object[] {"entity.bat.takeoff", 0.05f, 1f}),
            Map.entry(1026, new Object[] {"entity.zombie.infect", 2f, 1f}),
            Map.entry(1027, new Object[] {"entity.zombie_villager.converted", 2f, 1f}),
            Map.entry(1028, new Object[] {"entity.ender_dragon.death", 10000f, 1f}),
            Map.entry(1029, new Object[] {"block.anvil.destroy", 1f, 1f}),
            Map.entry(1030, new Object[] {"block.anvil.use", 1f, 1f}),
            Map.entry(1031, new Object[] {"block.anvil.land", 0.3f, 1f}),
            Map.entry(1033, new Object[] {"block.chorus_flower.grow", 1f, 1f}),
            Map.entry(1034, new Object[] {"block.chorus_flower.death", 1f, 1f}),
            Map.entry(1035, new Object[] {"block.brewing_stand.brew", 1f, 1f}),
            Map.entry(1038, new Object[] {"block.end_portal.spawn", 10000f, 1f}),
            Map.entry(1039, new Object[] {"entity.phantom.bite", 0.3f, 1f}),
            Map.entry(1040, new Object[] {"entity.zombie.converted_to_drowned", 2f, 1f}),
            Map.entry(1041, new Object[] {"entity.husk.converted_to_zombie", 2f, 1f}),
            Map.entry(1042, new Object[] {"block.grindstone.use", 1f, 1f}),
            Map.entry(1043, new Object[] {"item.book.page_turn", 1f, 1f}),
            Map.entry(1044, new Object[] {"block.smithing_table.use", 1f, 1f}),
            Map.entry(1045, new Object[] {"block.pointed_dripstone.land", 2f, 1f}),
            Map.entry(1046, new Object[] {"block.pointed_dripstone.drip_lava_into_cauldron", 2f, 1f}),
            Map.entry(1047, new Object[] {"block.pointed_dripstone.drip_water_into_cauldron", 2f, 1f}),
            Map.entry(1048, new Object[] {"entity.skeleton.converted_to_stray", 2f, 1f}),
            Map.entry(1501, new Object[] {"block.lava.extinguish", 0.5f, 2.6f}),
            Map.entry(1502, new Object[] {"block.redstone_torch.burnout", 0.5f, 2.6f}),
            Map.entry(1503, new Object[] {"block.end_portal_frame.fill", 1f, 1f}),
            Map.entry(2002, new Object[] {"entity.splash_potion.break", 1f, 1f}),
            Map.entry(2003, new Object[] {"entity.ender_eye.death", 1f, 1f}),
            Map.entry(2006, new Object[] {"entity.dragon_fireball.explode", 1f, 1f}),
            Map.entry(2007, new Object[] {"entity.splash_potion.break", 1f, 1f}));

    private final WcAssets assets;
    private final Map<String, JsonObject> messages = new ConcurrentHashMap<>();
    private volatile JsonObject defs;

    private final java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(3, r -> {
        Thread t = new Thread(r, "WebCraft sounds");
        t.setDaemon(true);
        return t;
    });

    WcSounds(WcAssets assets) {
        this.assets = assets;
    }

    /** Browser asks which files an event has (`sound` {e}); answered from a background thread. */
    void ask(WcSession s, String event) {
        if (event == null || s.soundsAsked.size() > 6000 || !s.soundsAsked.add("e:" + event)) return;
        pool.execute(() -> {
            JsonObject m = message(event);
            if (m != null) s.send(m);
            else s.soundsAsked.remove("e:" + event);
        });
    }

    /** Browser asks for one file (`sfile` {h}). */
    void askFile(WcSession s, String hash) {
        if (hash == null || s.soundsAsked.size() > 6000 || !s.soundsAsked.add("f:" + hash)) return;
        pool.execute(() -> {
            byte[] b = file(hash);
            if (b != null) s.send(b);
            else s.soundsAsked.remove("f:" + hash);
        });
    }

    /** Collects the captured sound packets of one tick into a message, or null when there were none. */
    static JsonObject take(Queue<Object> queue) {
        if (queue.isEmpty()) return null;
        JsonArray list = new JsonArray();
        Object o;
        while ((o = queue.poll()) != null) {
            if (list.size() >= MAX_PER_TICK) continue;   // drop the rest, the queue must not grow
            JsonArray e = switch (o) {
                case ClientboundSoundPacket p -> at(key(p.getSound().value()), p.getX(), p.getY(), p.getZ(), p.getVolume(), p.getPitch());
                case ClientboundSoundEntityPacket p -> {
                    JsonArray a = new JsonArray();
                    a.add(key(p.getSound().value()));
                    a.add("e");
                    a.add(p.getId());
                    a.add(round(p.getVolume()));
                    a.add(round(p.getPitch()));
                    yield a;
                }
                case ClientboundTakeItemEntityPacket p -> {
                    JsonArray a = new JsonArray();
                    a.add("take");
                    a.add(p.getItemId());
                    yield a;
                }
                case ClientboundLevelEventPacket ev -> event(ev);
                default -> null;
            };
            if (e != null) list.add(e);
        }
        if (list.isEmpty()) return null;
        JsonObject m = new JsonObject();
        m.addProperty("t", "snd");
        m.add("l", list);
        return m;
    }

    /** Whether a captured packet belongs to this class (the fake players put these into {@code session.sounds}). */
    static boolean wanted(ClientboundLevelEventPacket ev) {
        if (EVENTS.containsKey(ev.getType())) return true;
        return ev.getType() == 1500;   // composter
    }

    private static JsonArray event(ClientboundLevelEventPacket ev) {
        BlockPos pos = ev.getPos();
        Object[] s = EVENTS.get(ev.getType());
        if (ev.getType() == 1500) s = new Object[] {ev.getData() > 0 ? "block.composter.fill_success" : "block.composter.fill", 1f, 1f};
        if (s == null) return null;
        return at((String) s[0], pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5, (float) s[1], (float) s[2]);
    }

    private static JsonArray at(String key, double x, double y, double z, float volume, float pitch) {
        JsonArray a = new JsonArray();
        a.add(key);
        a.add(Math.round(x * 100) / 100.0);
        a.add(Math.round(y * 100) / 100.0);
        a.add(Math.round(z * 100) / 100.0);
        a.add(round(volume));
        a.add(round(pitch));
        return a;
    }

    private static double round(float v) {
        return Math.round(v * 1000) / 1000.0;
    }

    /** "block.stone.break" for minecraft sounds, "ns:path" for others. */
    static String key(SoundEvent e) {
        var id = e.location();
        return "minecraft".equals(id.getNamespace()) ? id.getPath() : id.toString();
    }

    /** The `sound` answer for an event (files with weight, volume, pitch), an empty list when unknown. */
    JsonObject message(String event) {
        if (event == null || event.length() > 120) return null;
        JsonObject cached = messages.get(event);
        if (cached != null) return cached;
        JsonArray list = new JsonArray();
        try {
            collect(defs(), event, 1f, 1f, list, 0);
        } catch (Exception e) {
            assets.log().warning("WebCraft: sounds not available: " + e.getMessage());
            return null;   // not cached: try again later
        }
        JsonObject m = new JsonObject();
        m.addProperty("t", "sound");
        m.addProperty("e", event);
        m.add("v", list);
        if (messages.size() < 5000) messages.put(event, m);
        return m;
    }

    /** One .ogg as binary message (2, hash, data), or null for hashes that are no sound of this version. */
    byte[] file(String hash) {
        try {
            if (hash == null || !soundHashes().contains(hash)) return null;
            byte[] data = assets.file(hash);
            ByteBuffer b = ByteBuffer.allocate(41 + data.length);
            b.put((byte) 2);
            b.put(hash.getBytes(StandardCharsets.US_ASCII));
            b.put(data);
            return b.array();
        } catch (Exception e) {
            assets.log().warning("WebCraft: sound file " + hash + " not available: " + e.getMessage());
            return null;
        }
    }

    private volatile Set<String> hashes;

    private Set<String> soundHashes() throws Exception {
        Set<String> h = hashes;
        if (h != null) return h;
        Set<String> all = ConcurrentHashMap.newKeySet();
        for (var e : assets.objects().entrySet()) {
            if (e.getKey().startsWith("minecraft/sounds/")) all.add(e.getValue().getAsJsonObject().get("hash").getAsString());
        }
        hashes = all;
        return all;
    }

    private JsonObject defs() throws Exception {
        JsonObject d = defs;
        if (d != null) return d;
        String hash = assets.hash("minecraft/sounds.json");
        if (hash == null) throw new IllegalStateException("no sounds.json in the asset index");
        d = JsonParser.parseString(new String(assets.file(hash), StandardCharsets.UTF_8)).getAsJsonObject();
        defs = d;
        return d;
    }

    /** Adds the files of an event; entries of type "event" point at another event. */
    private void collect(JsonObject defs, String event, float volume, float pitch, JsonArray out, int depth) throws Exception {
        if (depth > 4) return;
        String name = event.startsWith("minecraft:") ? event.substring(10) : event;
        if (name.contains(":")) return;   // other mods' sounds are not in Minecraft's assets
        JsonObject def = defs.getAsJsonObject(name);
        if (def == null || !def.has("sounds")) return;
        for (JsonElement el : def.getAsJsonArray("sounds")) {
            String file;
            float v = volume, p = pitch;
            int weight = 1;
            boolean stream = false;
            int attenuation = 16;
            boolean isEvent = false;
            if (el.isJsonPrimitive()) {
                file = el.getAsString();
            } else {
                JsonObject o = el.getAsJsonObject();
                file = o.get("name").getAsString();
                if (o.has("volume")) v *= o.get("volume").getAsFloat();
                if (o.has("pitch")) p *= o.get("pitch").getAsFloat();
                if (o.has("weight")) weight = o.get("weight").getAsInt();
                if (o.has("stream")) stream = o.get("stream").getAsBoolean();
                if (o.has("attenuation_distance")) attenuation = o.get("attenuation_distance").getAsInt();
                isEvent = o.has("type") && "event".equals(o.get("type").getAsString());
            }
            if (isEvent) {
                collect(defs, file, v, p, out, depth + 1);
                continue;
            }
            if (file.startsWith("minecraft:")) file = file.substring(10);
            String hash = assets.hash("minecraft/sounds/" + file + ".ogg");
            if (hash == null) continue;
            JsonArray a = new JsonArray();
            a.add(hash);
            a.add(weight);
            a.add(round(v));
            a.add(round(p));
            a.add(stream ? 1 : 0);
            a.add(attenuation);
            out.add(a);
        }
    }
}
