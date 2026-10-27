package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.BlockParticleOption;
import net.minecraft.core.particles.ColorParticleOption;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ClientboundLevelEventPacket;
import net.minecraft.network.protocol.game.ClientboundLevelParticlesPacket;
import net.minecraft.world.level.block.Block;

import java.util.Queue;

/**
 * Particles the server shows a normal client (hearts, explosions, potions, crits, block pieces of blocks
 * other players break ...) as one `fx` message per tick:
 * list of [kind, x, y, z, dx, dy, dz, speed, count, extra], extra = palette id (block particles) or RGB color.
 */
final class WcParticles {

    /** Block break particles of another player (Minecraft's level event 2001). */
    private static final int EVENT_BREAK = 2001;
    private static final int EVENT_SPAWNER = 2004;
    private static final int EVENT_BONE_MEAL = 1505;
    private static final int EVENT_SPLASH_POTION = 2002;
    private static final int EVENT_INSTANT_POTION = 2007;
    private static final int MAX_PER_TICK = 200;

    private WcParticles() {}

    /** Collects the captured packets of one tick into a message, or null when there were none. */
    static JsonObject take(Queue<Object> queue, BlockPalette palette) {
        if (queue.isEmpty()) return null;
        JsonArray list = new JsonArray();
        Object o;
        while ((o = queue.poll()) != null) {
            if (list.size() >= MAX_PER_TICK) continue;   // drop the rest, the queue must not grow
            JsonArray e = switch (o) {
                case ClientboundLevelParticlesPacket p -> particle(p, palette);
                case ClientboundLevelEventPacket ev -> event(ev, palette);
                default -> null;
            };
            if (e != null) list.add(e);
        }
        if (list.isEmpty()) return null;
        JsonObject m = new JsonObject();
        m.addProperty("t", "fx");
        m.add("l", list);
        return m;
    }

    private static JsonArray particle(ClientboundLevelParticlesPacket p, BlockPalette palette) {
        ParticleOptions opt = p.particle();
        var key = BuiltInRegistries.PARTICLE_TYPE.getKey(opt.getType());
        if (key == null) return null;
        Integer extra = switch (opt) {
            case BlockParticleOption b -> palette.idOf(b.getState());
            case DustParticleOptions d -> rgb(d.getColor().x(), d.getColor().y(), d.getColor().z());
            case ColorParticleOption c -> rgb(c.getRed(), c.getGreen(), c.getBlue());
            default -> null;
        };
        return entry(key.getPath(), p.x(), p.y(), p.z(), p.xDist(), p.yDist(), p.zDist(), p.xMaxSpeed(), p.count(), extra);
    }

    private static JsonArray event(ClientboundLevelEventPacket ev, BlockPalette palette) {
        BlockPos pos = ev.getPos();
        double x = pos.getX() + 0.5, y = pos.getY() + 0.5, z = pos.getZ() + 0.5;
        return switch (ev.getType()) {
            case EVENT_BREAK -> entry("break", pos.getX(), pos.getY(), pos.getZ(), 0, 0, 0, 0, 1,
                    palette.idOf(Block.stateById(ev.getData())));
            case EVENT_SPAWNER -> entry("flame", x, y, z, 0.3f, 0.3f, 0.3f, 0, 10, null);
            case EVENT_BONE_MEAL -> entry("happy_villager", x, y, z, 0.3f, 0.3f, 0.3f, 0, 12, null);
            case EVENT_SPLASH_POTION, EVENT_INSTANT_POTION -> entry("effect", x, y, z, 0.6f, 0.4f, 0.6f, 0.05f, 40, ev.getData() & 0xffffff);
            default -> null;
        };
    }

    private static int rgb(float r, float g, float b) {
        return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    }

    private static JsonArray entry(String kind, double x, double y, double z, float dx, float dy, float dz,
                                   float speed, int count, Integer extra) {
        JsonArray e = new JsonArray();
        e.add(kind);
        e.add(Math.round(x * 100) / 100.0);
        e.add(Math.round(y * 100) / 100.0);
        e.add(Math.round(z * 100) / 100.0);
        e.add(Math.round(dx * 100) / 100.0);
        e.add(Math.round(dy * 100) / 100.0);
        e.add(Math.round(dz * 100) / 100.0);
        e.add(Math.round(speed * 1000) / 1000.0);
        e.add(count);
        if (extra != null) e.add(extra);
        return e;
    }
}
