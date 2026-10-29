package de.p300.webcraft;

import com.google.gson.JsonObject;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundBossEventPacket;
import net.minecraft.world.BossEvent;

import java.util.UUID;

/**
 * Boss bars (wither, ender dragon, raids, plugin bars) for the browser: every captured ClientboundBossEventPacket
 * becomes a `boss` message {op: add|remove|progress|name|style, id, name, p (0..1), color, overlay}.
 */
final class WcBossBars {
    private WcBossBars() {}

    static void send(WcSession s, ClientboundBossEventPacket packet) {
        packet.dispatch(new ClientboundBossEventPacket.Handler() {
            @Override
            public void add(UUID id, Component name, float progress, BossEvent.BossBarColor color, BossEvent.BossBarOverlay overlay,
                            boolean darkenScreen, boolean playMusic, boolean createWorldFog) {
                JsonObject m = msg("add", id);
                m.addProperty("name", name.getString());
                m.addProperty("p", progress);
                m.addProperty("color", color.getName());
                m.addProperty("overlay", overlay.getName());
                s.send(m);
            }

            @Override
            public void remove(UUID id) {
                s.send(msg("remove", id));
            }

            @Override
            public void updateProgress(UUID id, float progress) {
                JsonObject m = msg("progress", id);
                m.addProperty("p", progress);
                s.send(m);
            }

            @Override
            public void updateName(UUID id, Component name) {
                JsonObject m = msg("name", id);
                m.addProperty("name", name.getString());
                s.send(m);
            }

            @Override
            public void updateStyle(UUID id, BossEvent.BossBarColor color, BossEvent.BossBarOverlay overlay) {
                JsonObject m = msg("style", id);
                m.addProperty("color", color.getName());
                m.addProperty("overlay", overlay.getName());
                s.send(m);
            }
        });
    }

    private static JsonObject msg(String op, UUID id) {
        JsonObject m = new JsonObject();
        m.addProperty("t", "boss");
        m.addProperty("op", op);
        m.addProperty("id", id.toString());
        return m;
    }
}
