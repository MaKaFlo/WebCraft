package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Voice chat of browser players. The browser sends Opus frames (48 kHz mono, 20 ms, like Simple Voice Chat) as
 * binary message 3. With Simple Voice Chat on the server ({@link Bridge}, see WcVoiceSvc) they go in as if the
 * player had the mod, and what the player would hear comes back. Without it the voice goes straight to the other
 * browser players near the speaker (or in the same group).
 * <p>
 * Threads: microphone frames arrive on the WebSocket threads and Simple Voice Chat delivers on its own threads,
 * so everything here is thread-safe; positions are refreshed from the server thread ({@link #update}).
 */
public final class WcVoice {

    public static volatile WcVoice instance;

    /** What a server's voice chat plugin has to offer (Simple Voice Chat). */
    public interface Bridge {
        boolean connect(Speaker s);
        void disconnect(Speaker s);
        void mic(Speaker s, byte[] opus);
        void end(Speaker s);
        void deaf(Speaker s, boolean deaf);
        List<JsonObject> groups();
        JsonObject groupOf(Speaker s);
        String join(Speaker s, String id, String password);
        String create(Speaker s, String name, String password, String type);
        void leave(Speaker s);
        double distance();
    }

    /** A player on the server (browser or not): for positions and names. */
    public record PlayerInfo(UUID uuid, int entityId, String world, double x, double y, double z, String name) {}

    /** A browser player with voice chat switched on. */
    public static final class Speaker {
        public final WcSession session;
        public volatile UUID uuid;
        public volatile boolean deaf;
        volatile Group group;               // built-in groups (no Simple Voice Chat)
        public volatile Object link;        // the bridge's own data
        Speaker(WcSession session) { this.session = session; }
    }

    private static final class Group {
        final String id = UUID.randomUUID().toString();
        final String name, password, type;
        Group(String name, String password, String type) { this.name = name; this.password = password; this.type = type; }
    }

    private static final double DISTANCE = 48;   // Simple Voice Chat's default

    private final Map<WcSession, Speaker> speakers = new ConcurrentHashMap<>();
    private final Map<String, Group> groups = new ConcurrentHashMap<>();
    private volatile Map<UUID, PlayerInfo> players = Map.of();
    private volatile Map<Integer, PlayerInfo> byEntity = Map.of();
    private volatile Bridge bridge;

    public void bridge(Bridge b) {
        bridge = b;
        // Everybody who talks already moves over to (or away from) the plugin
        for (Speaker s : speakers.values()) {
            if (b != null) b.connect(s);
            sendState(s, null);
        }
    }

    public boolean hasBridge() { return bridge != null; }

    /** Server thread, a few times per second: who is where, and which session plays which player. */
    public void update(Collection<PlayerInfo> all, Map<WcSession, UUID> sessionPlayers) {
        Map<UUID, PlayerInfo> m = new ConcurrentHashMap<>();
        Map<Integer, PlayerInfo> e = new ConcurrentHashMap<>();
        for (PlayerInfo p : all) { m.put(p.uuid(), p); e.put(p.entityId(), p); }
        players = m;
        byEntity = e;
        for (Speaker s : speakers.values()) {
            UUID u = sessionPlayers.get(s.session);
            if (u != null && !u.equals(s.uuid)) {
                // Joined (or respawned as a new player object): connect again
                s.uuid = u;
                Bridge b = bridge;
                if (b != null) b.connect(s);
            }
        }
    }

    public PlayerInfo player(UUID uuid) { return uuid == null ? null : players.get(uuid); }

    public Collection<PlayerInfo> players() { return players.values(); }

    // ------------------------------------------------------------------ messages from the browser

    /** Text messages `voice` {on, deaf} and `vgroup` {op: list/join/create/leave, id, name, pw, type}. */
    public void handle(WcSession session, JsonObject json) {
        String t = json.has("t") ? json.get("t").getAsString() : "";
        if (t.equals("voice")) {
            boolean on = json.has("on") && json.get("on").getAsBoolean();
            Speaker s = speakers.get(session);
            if (!on) {
                if (s != null) leave(session);
                return;
            }
            if (s == null) {
                s = new Speaker(session);
                speakers.put(session, s);
            }
            boolean deaf = json.has("deaf") && json.get("deaf").getAsBoolean();
            boolean changed = deaf != s.deaf;
            s.deaf = deaf;
            Bridge b = bridge;
            if (b != null) {
                if (s.link == null && s.uuid != null) b.connect(s);
                if (changed) b.deaf(s, deaf);
            }
            sendState(s, null);
        } else if (t.equals("vgroup")) {
            Speaker s = speakers.get(session);
            if (s == null) return;
            String op = str(json, "op"), err = null;
            Bridge b = bridge;
            switch (op) {
                case "join" -> err = b != null ? b.join(s, str(json, "id"), str(json, "pw")) : joinOwn(s, str(json, "id"), str(json, "pw"));
                case "create" -> {
                    String name = str(json, "name").trim();
                    if (name.isEmpty() || name.length() > 24) err = "Der Name braucht 1 bis 24 Zeichen";
                    else err = b != null ? b.create(s, name, str(json, "pw"), str(json, "type")) : createOwn(s, name, str(json, "pw"), str(json, "type"));
                }
                case "leave" -> { if (b != null) b.leave(s); else s.group = null; dropEmptyGroups(); }
                default -> { }
            }
            if (err != null) sendState(s, err);
            // The plugin applies group changes a moment later: then everybody gets the new lists
            java.util.concurrent.CompletableFuture.runAsync(this::groupsChanged,
                    java.util.concurrent.CompletableFuture.delayedExecutor(150, java.util.concurrent.TimeUnit.MILLISECONDS));
        }
    }

    private static String str(JsonObject j, String k) {
        return j.has(k) && !j.get(k).isJsonNull() ? j.get(k).getAsString() : "";
    }

    /** Binary message 3 from the browser: one Opus frame, or only the type byte when talking stops. */
    public void mic(WcSession session, ByteBuffer data) {
        Speaker s = speakers.get(session);
        if (s == null || s.uuid == null) return;
        Bridge b = bridge;
        if (!data.hasRemaining()) {
            if (b != null) b.end(s);
            return;
        }
        byte[] opus = new byte[data.remaining()];
        data.get(opus);
        if (b != null) {
            b.mic(s, opus);
            return;
        }
        // Without a voice chat plugin: to the browser players in the same group, or near the speaker
        PlayerInfo me = players.get(s.uuid);
        if (me == null) return;
        Group g = s.group;
        for (Speaker o : speakers.values()) {
            if (o == s || o.deaf || o.uuid == null) continue;
            if (g != null && o.group == g) {
                send(o, me.entityId(), KIND_STATIC, 0, 0, 0, 0, opus);
            } else if (g == null || g.type.equals("open")) {
                if (o.group != null && o.group.type.equals("isolated")) continue;   // isolated groups only hear each other
                PlayerInfo p = players.get(o.uuid);
                if (p == null || !p.world().equals(me.world())) continue;
                double dx = p.x() - me.x(), dy = p.y() - me.y(), dz = p.z() - me.z();
                if (dx * dx + dy * dy + dz * dz <= DISTANCE * DISTANCE) send(o, me.entityId(), KIND_ENTITY, me.x(), me.y() + 1.6, me.z(), DISTANCE, opus);
            }
        }
    }

    /** The browser closed (also logs out of the voice chat plugin). */
    public void leave(WcSession session) {
        Speaker s = speakers.remove(session);
        if (s == null) return;
        Bridge b = bridge;
        if (b != null && s.link != null) b.disconnect(s);
        s.group = null;
        dropEmptyGroups();
    }

    // ------------------------------------------------------------------ to the browser

    public static final int KIND_ENTITY = 0, KIND_POSITION = 1, KIND_STATIC = 2;

    /**
     * Binary message 3 to the browser: int32 entity id of the speaker (-1: unknown), uint8 kind (0 at the entity,
     * 1 at the position, 2 not placed: groups), float32 x, y, z, float32 hearing distance, then the Opus frame.
     */
    public void send(Speaker to, int entityId, int kind, double x, double y, double z, double distance, byte[] opus) {
        if (to.session.closed || to.deaf) return;
        ByteBuffer b = ByteBuffer.allocate(1 + 4 + 1 + 16 + opus.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put((byte) 3).putInt(entityId).put((byte) kind)
                .putFloat((float) x).putFloat((float) y).putFloat((float) z).putFloat((float) distance).put(opus);
        b.flip();
        try {
            to.session.conn.send(b);
        } catch (Exception ignored) {
            // closed meanwhile
        }
    }

    /** Entity id of a player (for the "talking" icon); -1 when unknown. */
    public int entityIdOf(UUID uuid) {
        PlayerInfo p = uuid == null ? null : players.get(uuid);
        return p == null ? -1 : p.entityId();
    }

    /** `voice` {svc, dist, group, groups, err}: the state for the voice menu. */
    public void sendState(Speaker s, String err) {
        Bridge b = bridge;
        JsonObject o = new JsonObject();
        o.addProperty("t", "voice");
        o.addProperty("svc", b != null);
        o.addProperty("dist", b != null ? b.distance() : DISTANCE);
        JsonObject mine = b != null ? b.groupOf(s) : ownGroupJson(s.group);
        if (mine != null) o.add("group", mine);
        JsonArray list = new JsonArray();
        for (JsonObject g : b != null ? b.groups() : ownGroups()) list.add(g);
        o.add("groups", list);
        if (err != null) o.addProperty("err", err);
        try {
            s.session.conn.send(o.toString());
        } catch (Exception ignored) {
            // closed meanwhile
        }
    }

    /** Group lists changed (someone joined or left): tell every browser that talks. */
    public void groupsChanged() {
        for (Speaker s : speakers.values()) sendState(s, null);
    }

    // ------------------------------------------------------------------ built-in groups (no Simple Voice Chat)

    private String joinOwn(Speaker s, String id, String pw) {
        Group g = groups.get(id);
        if (g == null) return "Die Gruppe gibt es nicht mehr";
        if (g.password != null && !g.password.equals(pw)) return "Falsches Passwort";
        s.group = g;
        dropEmptyGroups();
        groupsChanged();
        return null;
    }

    private String createOwn(Speaker s, String name, String pw, String type) {
        for (Group g : groups.values()) if (g.name.equalsIgnoreCase(name)) return "Den Namen gibt es schon";
        Group g = new Group(name, pw == null || pw.isEmpty() ? null : pw, type == null || type.isEmpty() ? "normal" : type);
        groups.put(g.id, g);
        s.group = g;
        dropEmptyGroups();
        groupsChanged();
        return null;
    }

    private void dropEmptyGroups() {
        groups.values().removeIf((g) -> speakers.values().stream().noneMatch((s) -> s.group == g));
    }

    private JsonObject ownGroupJson(Group g) {
        if (g == null) return null;
        JsonObject o = new JsonObject();
        o.addProperty("id", g.id);
        o.addProperty("name", g.name);
        o.addProperty("pw", g.password != null);
        o.addProperty("type", g.type);
        JsonArray members = new JsonArray();
        for (Speaker s : speakers.values()) {
            if (s.group != g) continue;
            PlayerInfo p = players.get(s.uuid);
            if (p != null) members.add(p.name());
        }
        o.add("members", members);
        return o;
    }

    private List<JsonObject> ownGroups() {
        List<JsonObject> out = new ArrayList<>();
        for (Group g : groups.values()) out.add(ownGroupJson(g));
        return out;
    }

}
