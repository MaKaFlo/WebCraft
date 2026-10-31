package de.p300.webcraft;

import com.google.gson.JsonObject;
import net.minecraft.core.Vec3i;
import net.minecraft.network.protocol.game.ClientboundTrackedWaypointPacket;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.waypoints.TrackedWaypoint;

import java.lang.reflect.Field;

/**
 * Minecraft's locator bar: every captured ClientboundTrackedWaypointPacket becomes a `wp` message {op: track|update|
 * untrack, id, c (RGB, missing: the browser picks one from the id), and either p [x, y, z] (a player nearby), ch
 * [chunk x, chunk z] (further away) or a (azimuth in radians: far away)}. The waypoint subclasses keep their
 * position in private fields, so they are read by type.
 */
final class WcWaypoints {
    private WcWaypoints() {}

    static void send(WcSession s, ClientboundTrackedWaypointPacket packet) {
        TrackedWaypoint w = packet.waypoint();
        JsonObject m = new JsonObject();
        m.addProperty("t", "wp");
        Object op = packet.operation();   // the enum class is not public
        m.addProperty("op", ((Enum<?>) op).name().toLowerCase(java.util.Locale.ROOT));
        m.addProperty("id", w.id().map(java.util.UUID::toString, (str) -> str));
        w.icon().color.ifPresent((c) -> m.addProperty("c", c & 0xFFFFFF));
        try {
            for (Class<?> c = w.getClass(); c != TrackedWaypoint.class && c != null; c = c.getSuperclass()) {
                for (Field f : c.getDeclaredFields()) {
                    if (java.lang.reflect.Modifier.isStatic(f.getModifiers())) continue;
                    f.setAccessible(true);
                    Object v = f.get(w);
                    if (v instanceof Vec3i p) {
                        com.google.gson.JsonArray a = new com.google.gson.JsonArray();
                        a.add(p.getX()); a.add(p.getY()); a.add(p.getZ());
                        m.add("p", a);
                    } else if (v instanceof ChunkPos ch) {
                        com.google.gson.JsonArray a = new com.google.gson.JsonArray();
                        a.add(ch.x()); a.add(ch.z());
                        m.add("ch", a);
                    } else if (v instanceof Float f2) {
                        m.addProperty("a", f2);
                    }
                }
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // another Minecraft version: only the id and color then
        }
        s.send(m);
    }
}
