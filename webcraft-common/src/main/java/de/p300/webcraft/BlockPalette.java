package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.LiquidBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.VoxelShape;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * Global block palette shared by all WebCraft clients.
 *
 * Every distinct look/shape of a block gets an id (slab bottom vs. top, open vs. closed door, snow with
 * 1..8 layers ...). States that look and collide the same share an id, so the palette stays small.
 * Entries are created on demand (also from chunk-encoding threads) and sent to each client before
 * the first data that uses them. Id 0 is air.
 */
public final class BlockPalette {

    public static final int AIR = 0;
    private static final BlockPos ORIGIN = BlockPos.ZERO;

    private final Map<BlockState, Integer> byState = new ConcurrentHashMap<>();
    private final Map<String, Integer> byKey = new HashMap<>();
    private final List<JsonObject> entries = new ArrayList<>();
    private final Logger log;

    public BlockPalette(Logger log) {
        this.log = log;
        JsonObject air = new JsonObject();
        air.addProperty("n", "air");
        air.addProperty("c", 0);
        air.addProperty("f", 0);
        entries.add(air);
        byKey.put("air", AIR);
    }

    public int idOf(BlockState state) {
        if (state == null || state.isAir()) return AIR;
        Integer id = byState.get(state);
        return id != null ? id : register(state);
    }

    private synchronized int register(BlockState state) {
        Integer known = byState.get(state);
        if (known != null) return known;

        JsonObject e = describe(state);
        String key = e.toString();
        Integer id = byKey.get(key);
        if (id == null) {
            id = entries.size();
            entries.add(e);
            byKey.put(key, id);
            if (id > 60000) log.warning("WebCraft palette is getting very large: " + id);
        }
        byState.put(state, id);
        return id;
    }

    /**
     * The sound a door, trapdoor, fence gate, button or lever makes when it gets into this state: [sound, volume, pitch].
     * The server leaves the player who clicked out of it (his client makes it), so the browser plays it itself.
     */
    private static JsonArray useSound(BlockState state) {
        var block = state.getBlock();
        String key = null;
        float volume = 1f, pitch = 1f;
        try {
            if (block instanceof net.minecraft.world.level.block.LeverBlock) {
                boolean on = state.getValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.POWERED);
                key = "block.lever.click";
                volume = 0.3f;
                pitch = on ? 0.6f : 0.5f;
            } else if (block instanceof net.minecraft.world.level.block.DoorBlock door) {
                boolean open = state.getValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.OPEN);
                key = WcSounds.key(open ? door.type().doorOpen() : door.type().doorClose());
            } else if (block instanceof net.minecraft.world.level.block.TrapDoorBlock) {
                boolean open = state.getValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.OPEN);
                var type = (net.minecraft.world.level.block.state.properties.BlockSetType) field(block, net.minecraft.world.level.block.TrapDoorBlock.class);
                key = WcSounds.key(open ? type.trapdoorOpen() : type.trapdoorClose());
            } else if (block instanceof net.minecraft.world.level.block.FenceGateBlock) {
                boolean open = state.getValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.OPEN);
                var type = (net.minecraft.world.level.block.state.properties.WoodType) field(block, net.minecraft.world.level.block.FenceGateBlock.class);
                key = WcSounds.key(open ? type.fenceGateOpen() : type.fenceGateClose());
            } else if (block instanceof net.minecraft.world.level.block.ButtonBlock) {
                boolean on = state.getValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.POWERED);
                var type = (net.minecraft.world.level.block.state.properties.BlockSetType) field(block, net.minecraft.world.level.block.ButtonBlock.class);
                key = WcSounds.key(on ? type.buttonClickOn() : type.buttonClickOff());
            }
        } catch (Throwable ignored) {
            return null;
        }
        if (key == null) return null;
        JsonArray a = new JsonArray();
        a.add(key);
        a.add(volume);
        a.add(pitch);
        return a;
    }

    /** The private "type" field of a block class (fence gates and buttons have no public getter). */
    private static Object field(Object block, Class<?> owner) throws ReflectiveOperationException {
        var f = owner.getDeclaredField("type");
        f.setAccessible(true);
        return f.get(block);
    }

    private static JsonObject describe(BlockState state) {
        JsonObject e = new JsonObject();
        e.addProperty("n", BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath());
        int color = 0x808080;
        try {
            color = state.getMapColor(EmptyBlockGetter.INSTANCE, ORIGIN).col;
        } catch (Throwable ignored) {
        }
        e.addProperty("c", color);

        boolean liquid = state.getBlock() instanceof LiquidBlock;
        VoxelShape collision = safeCollision(state);
        VoxelShape shape = safeShape(state);
        boolean solid = !liquid && !collision.isEmpty();
        boolean fullShape = isFull(shape);
        int flags = 0;
        if (solid) flags |= 1;
        if (!liquid && state.canOcclude() && fullShape) flags |= 2;
        if (liquid) flags |= 4;
        e.addProperty("f", flags);

        // Which way the block looks (furnace, chest, pumpkin ...): the browser draws the "_front" picture there
        if (state.hasProperty(net.minecraft.world.level.block.state.properties.BlockStateProperties.HORIZONTAL_FACING)) {
            e.addProperty("fa", state.getValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.HORIZONTAL_FACING).getSerializedName());
        }

        // Blocks the browser draws by their state (redstone parts, pistons, rails, torches, signs): all properties
        String name = e.get("n").getAsString();
        if (STATE_DRAWN.matcher(name).matches()) {
            JsonObject props = new JsonObject();
            for (var prop : state.getProperties()) props.addProperty(prop.getName(), propValue(state, prop));
            if (!props.isEmpty()) e.add("p", props);
        }

        // Light the block gives (torch 14, lava 15 ...): the browser spreads it like Minecraft's block light
        int light = state.getLightEmission();
        if (light > 0) e.addProperty("le", light);

        // Burning furnaces, campfires, candles, redstone torches: the browser shows flames and smoke
        if (state.hasProperty(net.minecraft.world.level.block.state.properties.BlockStateProperties.LIT)
                && state.getValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.LIT)) {
            e.addProperty("li", 1);
        }

        // Sounds for steps, digging, placing (the browser plays them for its own player like the vanilla client)
        try {
            var st = state.getSoundType();
            String[] keys = {WcSounds.key(st.getBreakSound()), WcSounds.key(st.getStepSound()), WcSounds.key(st.getPlaceSound()),
                    WcSounds.key(st.getHitSound()), WcSounds.key(st.getFallSound())};
            String[] ends = {".break", ".step", ".place", ".hit", ".fall"};
            String group = keys[0].startsWith("block.") && keys[0].endsWith(".break") ? keys[0].substring(6, keys[0].length() - 6) : null;
            for (int i = 0; group != null && i < 5; i++) if (!keys[i].equals("block." + group + ends[i])) group = null;
            if (group != null) e.addProperty("so", group);
            else {
                JsonArray a = new JsonArray();
                for (String k : keys) a.add(k);
                e.add("so", a);
            }
            if (st.getVolume() != 1f) e.addProperty("sv", st.getVolume());
            if (st.getPitch() != 1f) e.addProperty("sp", st.getPitch());
        } catch (Throwable ignored) {
        }
        JsonArray use = useSound(state);
        if (use != null) e.add("us", use);

        // Water and lava: how full the block is (flowing water gets lower, falling water is a full column)
        if (liquid) {
            var fluid = state.getFluidState();
            if (!fluid.isEmpty()) {
                e.addProperty("lh", Math.round(fluid.getOwnHeight() * 1000) / 1000.0);
                if (!fluid.isSource() && fluid.hasProperty(net.minecraft.world.level.material.FlowingFluid.FALLING)
                        && fluid.getValue(net.minecraft.world.level.material.FlowingFluid.FALLING)) e.addProperty("lf", 1);
            }
        }

        // Shapes as one box each (good enough for drawing and for walking around)
        if (!liquid && !shape.isEmpty() && !fullShape) e.add("r", box(shape.bounds()));
        if (solid && !isFull(collision)) e.add("b", box(collision.bounds()));
        // Shapes made of several boxes (stairs, fences, walls ...): send the boxes too
        if (!liquid && !shape.isEmpty() && !fullShape) {
            JsonArray parts = boxes(shape);
            if (parts != null) e.add("rs", parts);
        }
        if (solid && !isFull(collision)) {
            JsonArray parts = boxes(collision);
            if (parts != null) e.add("bs", parts);
        }
        return e;
    }

    private static final java.util.regex.Pattern STATE_DRAWN = java.util.regex.Pattern.compile(
            "(sticky_)?piston(_head)?|repeater|comparator|redstone_wire|observer|dispenser|dropper|hopper|(powered_|detector_|activator_)?rail"
                    + "|redstone_lamp|daylight_detector|lever|(\\w+_)?(wall_)?torch|\\w+_sign|end_rod|(\\w+_)?lightning_rod|(\\w+_)?lantern");

    private static <T extends Comparable<T>> String propValue(BlockState state, net.minecraft.world.level.block.state.properties.Property<T> prop) {
        return prop.getName(state.getValue(prop));
    }

    private static VoxelShape safeShape(BlockState s) {
        try {
            return s.getShape(EmptyBlockGetter.INSTANCE, ORIGIN);
        } catch (Throwable t) {
            return net.minecraft.world.phys.shapes.Shapes.block();
        }
    }

    private static VoxelShape safeCollision(BlockState s) {
        try {
            return s.getCollisionShape(EmptyBlockGetter.INSTANCE, ORIGIN);
        } catch (Throwable t) {
            return net.minecraft.world.phys.shapes.Shapes.block();
        }
    }

    private static boolean isFull(VoxelShape shape) {
        if (shape.isEmpty()) return false;
        AABB b = shape.bounds();
        return b.minX <= 0 && b.minY <= 0 && b.minZ <= 0 && b.maxX >= 1 && b.maxY >= 1 && b.maxZ >= 1
                && shape.toAabbs().size() == 1;
    }

    /** All boxes of a shape (null if it is just one box, max 12). */
    private static JsonArray boxes(VoxelShape shape) {
        java.util.List<AABB> list = shape.toAabbs();
        if (list.size() <= 1 || list.size() > 12) return null;
        JsonArray a = new JsonArray();
        for (AABB b : list) a.add(box(b));
        return a;
    }

    private static JsonArray box(AABB b) {
        JsonArray a = new JsonArray();
        for (double v : new double[]{b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ}) a.add(Math.round(v * 10000) / 10000.0);
        return a;
    }

    public synchronized int size() {
        return entries.size();
    }

    /** Palette message with all entries from index {@code from} on, or null if there are none. */
    public synchronized JsonObject messageFrom(int from) {
        if (from >= entries.size()) return null;
        JsonObject msg = new JsonObject();
        msg.addProperty("t", "pal");
        msg.addProperty("start", from);
        JsonArray list = new JsonArray();
        for (int i = from; i < entries.size(); i++) list.add(entries.get(i));
        msg.add("entries", list);
        return msg;
    }
}
