package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.level.block.entity.SignText;
import net.minecraft.world.level.chunk.LevelChunk;

import java.util.Queue;

/**
 * Sign texts for the browser: {@code signs} {l: [{x, y, z, f: {l: [4 lines], c: color, g: glowing}, b: {...}}]}.
 * An entry without {@code f} means "no sign here any more". Sent with every chunk and when the server tells the
 * player about a changed sign (block entity packet). Main thread only.
 */
public final class WcSigns {

    private WcSigns() {
    }

    /** Message with all signs of a chunk, or null. */
    public static JsonObject ofChunk(LevelChunk chunk) {
        if (chunk == null) return null;
        JsonArray list = new JsonArray();
        for (BlockEntity be : chunk.getBlockEntities().values()) {
            if (be instanceof SignBlockEntity sign) list.add(entry(sign));
        }
        return message(list);
    }

    /** Message for the signs whose block entity changed since the last tick, or null. */
    public static JsonObject take(Queue<BlockPos> changed, Level level) {
        if (changed.isEmpty()) return null;
        JsonArray list = new JsonArray();
        java.util.Set<BlockPos> seen = new java.util.HashSet<>();
        BlockPos pos;
        while ((pos = changed.poll()) != null) {
            if (!seen.add(pos)) continue;
            if (!level.isLoaded(pos)) continue;
            if (level.getBlockEntity(pos) instanceof SignBlockEntity sign) list.add(entry(sign));
            else {
                JsonObject gone = new JsonObject();
                gone.addProperty("x", pos.getX());
                gone.addProperty("y", pos.getY());
                gone.addProperty("z", pos.getZ());
                list.add(gone);
            }
        }
        return message(list);
    }

    private static JsonObject message(JsonArray list) {
        if (list.isEmpty()) return null;
        JsonObject m = new JsonObject();
        m.addProperty("t", "signs");
        m.add("l", list);
        return m;
    }

    private static JsonObject entry(SignBlockEntity sign) {
        BlockPos pos = sign.getBlockPos();
        JsonObject e = new JsonObject();
        e.addProperty("x", pos.getX());
        e.addProperty("y", pos.getY());
        e.addProperty("z", pos.getZ());
        e.add("f", side(sign.getText(net.minecraft.world.level.block.entity.SignTextSlot.FRONT)));
        e.add("b", side(sign.getText(net.minecraft.world.level.block.entity.SignTextSlot.BACK)));
        return e;
    }

    private static JsonObject side(SignText text) {
        JsonObject o = new JsonObject();
        JsonArray lines = new JsonArray();
        for (var line : text.getMessages(false)) lines.add(line.getString());
        o.add("l", lines);
        o.addProperty("c", text.getColor().getSerializedName());
        if (text.hasGlowingText()) o.addProperty("g", 1);
        return o;
    }
}
