package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import de.maxhenkel.voicechat.api.Group;
import de.maxhenkel.voicechat.api.Position;
import de.maxhenkel.voicechat.api.VoicechatApi;
import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.audiolistener.PlayerAudioListener;
import de.maxhenkel.voicechat.api.audiosender.AudioSender;
import de.maxhenkel.voicechat.api.events.CreateGroupEvent;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.JoinGroupEvent;
import de.maxhenkel.voicechat.api.events.LeaveGroupEvent;
import de.maxhenkel.voicechat.api.events.RemoveGroupEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStartedEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStoppedEvent;
import de.maxhenkel.voicechat.api.packets.EntitySoundPacket;
import de.maxhenkel.voicechat.api.packets.LocationalSoundPacket;
import de.maxhenkel.voicechat.api.packets.SoundPacket;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Simple Voice Chat plugin of WebCraft: a browser player counts as a player without the mod who is connected
 * ({@link VoicechatConnection#setConnected}); the microphone goes in through an {@link AudioSender}, and a
 * {@link PlayerAudioListener} gets everything the player would hear. Groups are Simple Voice Chat's own, so Java
 * players see the browser players in them. Paper registers it through BukkitVoicechatService, Fabric through the
 * "voicechat" entrypoint (then this class is created by the mod and finds {@link WcVoice#instance}).
 */
public final class WcVoiceSvc implements VoicechatPlugin, WcVoice.Bridge {

    private volatile VoicechatServerApi api;

    private record Link(VoicechatConnection connection, AudioSender sender, PlayerAudioListener listener) {}

    @Override
    public String getPluginId() {
        return "webcraft";
    }

    @Override
    public void initialize(VoicechatApi api) {
    }

    @Override
    public void registerEvents(EventRegistration r) {
        r.registerEvent(VoicechatServerStartedEvent.class, (e) -> {
            api = e.getVoicechat();
            WcVoice v = WcVoice.instance;
            if (v != null) v.bridge(this);
        });
        r.registerEvent(VoicechatServerStoppedEvent.class, (e) -> {
            api = null;
            WcVoice v = WcVoice.instance;
            if (v != null) v.bridge(null);
        });
        // Group lists in the browsers stay current (the event comes before the change)
        r.registerEvent(JoinGroupEvent.class, (e) -> groupsChanged());
        r.registerEvent(LeaveGroupEvent.class, (e) -> groupsChanged());
        r.registerEvent(CreateGroupEvent.class, (e) -> groupsChanged());
        r.registerEvent(RemoveGroupEvent.class, (e) -> groupsChanged());
    }

    private static void groupsChanged() {
        CompletableFuture.runAsync(() -> {
            WcVoice v = WcVoice.instance;
            if (v != null) v.groupsChanged();
        }, CompletableFuture.delayedExecutor(200, TimeUnit.MILLISECONDS));
    }

    private static Link link(WcVoice.Speaker s) {
        return s.link instanceof Link l ? l : null;
    }

    /** The player's connection now (the object from connect() keeps an old copy of the group). */
    private VoicechatConnection conn(WcVoice.Speaker s) {
        VoicechatServerApi a = api;
        return a == null || s.uuid == null || link(s) == null ? null : a.getConnectionOf(s.uuid);
    }

    @Override
    public synchronized boolean connect(WcVoice.Speaker s) {
        VoicechatServerApi a = api;
        if (a == null || s.uuid == null) return false;
        Link old = link(s);
        if (old != null) disconnect(s);
        VoicechatConnection c = a.getConnectionOf(s.uuid);
        if (c == null || c.isInstalled()) return false;
        c.setConnected(true);
        c.setDisabled(s.deaf);
        AudioSender sender = a.createAudioSender(c);
        a.registerAudioSender(sender);
        WcVoice v = WcVoice.instance;
        PlayerAudioListener listener = a.playerAudioListenerBuilder().setPlayer(s.uuid)
                .setPacketListener((p) -> deliver(v, s, p)).build();
        a.registerAudioListener(listener);
        s.link = new Link(c, sender, listener);
        return true;
    }

    /** Something the player would hear: to the browser with the speaker's entity and where it is. */
    private void deliver(WcVoice v, WcVoice.Speaker s, SoundPacket p) {
        if (v == null || s.deaf) return;
        int id = v.entityIdOf(p.getSender());
        if (p instanceof EntitySoundPacket e) {
            WcVoice.PlayerInfo at = v.player(e.getEntityUuid());
            int eid = at != null ? at.entityId() : id;
            v.send(s, eid, WcVoice.KIND_ENTITY, at != null ? at.x() : 0, at != null ? at.y() + 1.6 : 0, at != null ? at.z() : 0,
                    e.getDistance(), p.getOpusEncodedData());
        } else if (p instanceof LocationalSoundPacket l) {
            Position pos = l.getPosition();
            v.send(s, id, WcVoice.KIND_POSITION, pos.getX(), pos.getY(), pos.getZ(), l.getDistance(), p.getOpusEncodedData());
        } else {
            v.send(s, id, WcVoice.KIND_STATIC, 0, 0, 0, 0, p.getOpusEncodedData());
        }
    }

    @Override
    public synchronized void disconnect(WcVoice.Speaker s) {
        VoicechatServerApi a = api;
        Link l = link(s);
        s.link = null;
        if (a == null || l == null) return;
        a.unregisterAudioSender(l.sender());
        a.unregisterAudioListener(l.listener());
        try {
            l.connection().setConnected(false);
        } catch (Exception ignored) {
            // player already gone
        }
    }

    @Override
    public void mic(WcVoice.Speaker s, byte[] opus) {
        Link l = link(s);
        if (l != null) l.sender().send(opus);
    }

    @Override
    public void end(WcVoice.Speaker s) {
        Link l = link(s);
        if (l != null) l.sender().reset();
    }

    @Override
    public void deaf(WcVoice.Speaker s, boolean deaf) {
        VoicechatConnection c = conn(s);
        if (c != null) c.setDisabled(deaf);
    }

    @Override
    public double distance() {
        VoicechatServerApi a = api;
        return a != null ? a.getVoiceChatDistance() : 48;
    }

    // ------------------------------------------------------------------ groups

    private static String typeName(Group g) {
        Group.Type t = g.getType();
        return t == Group.Type.OPEN ? "open" : t == Group.Type.ISOLATED ? "isolated" : "normal";
    }

    private JsonObject json(Group g) {
        JsonObject o = new JsonObject();
        o.addProperty("id", g.getId().toString());
        o.addProperty("name", g.getName());
        o.addProperty("pw", g.hasPassword());
        o.addProperty("type", typeName(g));
        JsonArray members = new JsonArray();
        VoicechatServerApi a = api;
        WcVoice v = WcVoice.instance;
        if (a != null && v != null) {
            for (WcVoice.PlayerInfo p : v.players()) {
                VoicechatConnection c = a.getConnectionOf(p.uuid());
                if (c != null && c.getGroup() != null && c.getGroup().getId().equals(g.getId())) members.add(p.name());
            }
        }
        o.add("members", members);
        return o;
    }

    @Override
    public List<JsonObject> groups() {
        List<JsonObject> out = new ArrayList<>();
        VoicechatServerApi a = api;
        if (a == null) return out;
        for (Group g : a.getGroups()) if (!g.isHidden()) out.add(json(g));
        return out;
    }

    @Override
    public JsonObject groupOf(WcVoice.Speaker s) {
        VoicechatConnection c = conn(s);
        Group g = c != null ? c.getGroup() : null;
        return g != null ? json(g) : null;
    }

    @Override
    public String join(WcVoice.Speaker s, String id, String password) {
        VoicechatServerApi a = api;
        VoicechatConnection c = conn(s);
        if (a == null || c == null) return "Sprachchat ist nicht verbunden";
        Group g;
        try {
            g = a.getGroup(UUID.fromString(id));
        } catch (IllegalArgumentException e) {
            g = null;
        }
        if (g == null) return "Die Gruppe gibt es nicht mehr";
        if (g.hasPassword()) {
            String real = password(g);
            if (real == null) return "Gruppen mit Passwort gehen hier noch nicht";
            if (!real.equals(password)) return "Falsches Passwort";
        }
        c.setGroup(g);
        return null;
    }

    @Override
    public String create(WcVoice.Speaker s, String name, String password, String type) {
        VoicechatServerApi a = api;
        VoicechatConnection c = conn(s);
        if (a == null || c == null) return "Sprachchat ist nicht verbunden";
        for (Group g : a.getGroups()) if (g.getName().equalsIgnoreCase(name)) return "Den Namen gibt es schon";
        Group.Type t = "open".equals(type) ? Group.Type.OPEN : "isolated".equals(type) ? Group.Type.ISOLATED : Group.Type.NORMAL;
        Group g = a.groupBuilder().setName(name).setPassword(password == null || password.isEmpty() ? null : password)
                .setType(t).setPersistent(false).build();
        c.setGroup(g);
        return null;
    }

    @Override
    public void leave(WcVoice.Speaker s) {
        VoicechatConnection c = conn(s);
        if (c != null) c.setGroup(null);
    }

    /**
     * The API only tells whether a group has a password; the plugin's group object behind it knows the password
     * (a field holding the server group, which has getPassword()). Null when that is not found.
     */
    private static String password(Group g) {
        try {
            for (Class<?> c = g.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
                Method direct = findGetter(c);
                if (direct != null) return (String) direct.invoke(g);
                for (Field f : c.getDeclaredFields()) {
                    f.setAccessible(true);
                    Object inner = f.get(g);
                    if (inner == null || inner == g) continue;
                    Method m = findGetter(inner.getClass());
                    if (m != null) return Objects.toString(m.invoke(inner), "");
                }
            }
        } catch (Exception ignored) {
            // unknown plugin version
        }
        return null;
    }

    private static Method findGetter(Class<?> c) {
        try {
            Method m = c.getMethod("getPassword");
            m.setAccessible(true);
            return m.getReturnType() == String.class ? m : null;
        } catch (NoSuchMethodException e) {
            return null;
        }
    }
}
