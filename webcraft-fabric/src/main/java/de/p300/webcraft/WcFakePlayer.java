package de.p300.webcraft;

import com.mojang.authlib.GameProfile;
import io.netty.channel.ChannelFutureListener;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.embedded.EmbeddedChannel;
import it.unimi.dsi.fastutil.ints.Int2ObjectMaps;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.Connection;
import net.minecraft.network.DisconnectionDetails;
import net.minecraft.network.HashedStack;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.BundlePacket;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.common.ClientboundDisconnectPacket;
import net.minecraft.network.protocol.common.ClientboundKeepAlivePacket;
import net.minecraft.network.protocol.common.ServerboundKeepAlivePacket;
import net.minecraft.network.protocol.game.*;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.server.players.NameAndId;
import net.minecraft.util.Mth;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Input;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.storage.LevelData;
import net.minecraft.world.level.storage.TagValueInput;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

import java.net.InetSocketAddress;
import java.net.SocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * A WebCraft player as a real server player (Fabric version of the Paper plugin's class, plain Minecraft 26.3).
 *
 * The browser's actions are turned into the same packets a Minecraft client would send, and handed to the
 * server's normal packet handlers. So damage, death, mods, commands and menus behave exactly as for a
 * Minecraft player. Packets the server sends back are caught by {@link FakeConnection}.
 */
public final class WcFakePlayer {

    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger("WebCraft");

    private final WcMod mod;
    private final WcSession session;
    private final String name;
    private FakeConnection connection;
    /** Stays the same for the whole visit; its player object is replaced on respawn. */
    private ServerGamePacketListenerImpl gameListener;
    /** The player while it joins (before the server created its packet listener). */
    private ServerPlayer joining;
    private int sequence = 1;
    private volatile boolean removed;
    /** Title of the open container (the server only sends it with the open-screen packet). */
    private volatile String menuTitle = "";

    private WcFakePlayer(WcMod mod, WcSession session, String name) {
        this.mod = mod;
        this.session = session;
        this.name = name;
    }

    public static UUID uuidFor(String name) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
    }

    /** Creates the player and lets it join the server like a normal login. */
    public static WcFakePlayer join(WcMod mod, WcSession session, String name, ServerLevel level, SocketAddress address) {
        MinecraftServer server = mod.server();
        WcFakePlayer fake = new WcFakePlayer(mod, session, name);
        GameProfile profile = WcSkins.profile(uuidFor(name), name, session.skin);
        // Like a real client with the server's view distance, so the chunks around the player tick
        ClientInformation def = ClientInformation.createDefault();
        int view = Math.max(4, Math.min(12, server.getPlayerList().getViewDistance()));
        ClientInformation info = new ClientInformation(def.language(), view, def.chatVisibility(), def.chatColors(),
                def.modelCustomisation(), def.mainHand(), def.textFilteringEnabled(), def.allowsListing(), def.particleStatus());

        // Saved player data (position, dimension, inventory, health ...) like a normal login
        Optional<CompoundTag> data = server.getPlayerList().loadPlayerData(new NameAndId(profile));
        if (data.isPresent()) {
            String dim = data.get().getString("Dimension").orElse(null);
            Identifier id = dim == null ? null : Identifier.tryParse(dim);
            ServerLevel saved = id == null ? null : server.getLevel(ResourceKey.create(Registries.DIMENSION, id));
            if (saved != null) level = saved;
        }

        ServerPlayer sp = new ServerPlayer(server, level, profile, info);
        fake.joining = sp;
        FakeConnection conn = new FakeConnection(fake);
        conn.init(new EmbeddedChannel(new ChannelInboundHandlerAdapter()),
                address instanceof InetSocketAddress ? address : new InetSocketAddress("127.0.0.1", 0));
        fake.connection = conn;

        CommonListenerCookie cookie = new CommonListenerCookie(profile, 0, info, false);
        try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(LOG)) {
            Optional<ValueInput> input = data.map(tag -> TagValueInput.create(reporter, server.registryAccess(), tag));
            input.ifPresent(sp::load);
            if (input.isPresent()) {
                sp.snapTo(sp.getX(), sp.getY(), sp.getZ(), sp.getYRot(), sp.getXRot());
            } else {
                // First visit: world spawn, on top of the ground
                LevelData.RespawnData spawn = server.getRespawnData();
                ServerLevel spawnLevel = server.getLevel(spawn.dimension());
                if (spawnLevel != null) sp.setServerLevel(spawnLevel);
                BlockPos pos = spawn.pos();
                sp.level().getChunk(pos.getX() >> 4, pos.getZ() >> 4);   // the height map needs the chunk
                int y = sp.level().getHeight(Heightmap.Types.MOTION_BLOCKING, pos.getX(), pos.getZ());
                sp.snapTo(pos.getX() + 0.5, y, pos.getZ() + 0.5, spawn.yaw(), 0f);
            }
            // A real login has the chunk under the player loaded before it joins
            sp.level().getChunk(Mth.floor(sp.getX()) >> 4, Mth.floor(sp.getZ()) >> 4);
            server.getPlayerList().placeNewPlayer(conn, sp, cookie);
            fake.gameListener = sp.connection;
            input.ifPresent(i -> {
                sp.loadAndSpawnEnderPearls(i);
                sp.loadAndSpawnParentVehicle(i);
            });
        }
        fake.listener().handleAcceptPlayerLoad(new ServerboundPlayerLoadedPacket());
        return fake;
    }

    public String name() {
        return name;
    }

    /** The current Minecraft player object (it is replaced on respawn). */
    public ServerPlayer handle() {
        return gameListener != null ? gameListener.player : joining;
    }

    private ServerGamePacketListenerImpl listener() {
        return gameListener != null ? gameListener : joining.connection;
    }

    public boolean isRemoved() {
        return removed;
    }

    // ------------------------------------------------------------------ called every server tick

    public void tick() {
        if (removed) return;
        try {
            // Like a real client: at most one position update per tick, then "tick end"
            ServerboundMovePlayerPacket move = pendingMove;
            pendingMove = null;
            if (move != null) listener().handleMovePlayer(move);
            listener().handleClientTickEnd(ServerboundClientTickEndPacket.INSTANCE);
            listener().tick();
            ticks++;
            if (pendingStopAt >= 0 && (ticks >= pendingStopAt || digDone())) flushPendingStop();
            resendLostTeleport();
        } catch (Exception e) {
            LOG.warn("WebCraft player tick failed for {}: {}", name, e.toString());
        }
        // Drop anything that was written straight to the dummy channel
        EmbeddedChannel ch = connection.embedded;
        ch.runPendingTasks();
        ch.releaseOutbound();
        ch.releaseInbound();
    }

    // ------------------------------------------------------------------ actions from the browser

    private ServerboundMovePlayerPacket pendingMove;

    /** Remember the newest position; it is sent to the server on the next tick. */
    public void move(double x, double y, double z, float yaw, float pitch, boolean onGround) {
        if (Double.isNaN(x) || Double.isNaN(y) || Double.isNaN(z)) return;
        pendingMove = new ServerboundMovePlayerPacket.PosRot(x, y, z, yaw, pitch, onGround, false);
    }

    private boolean lastSprint;

    public void input(boolean fwd, boolean back, boolean left, boolean right, boolean jump, boolean sneak, boolean sprint) {
        listener().handlePlayerInput(new ServerboundPlayerInputPacket(new Input(fwd, back, left, right, jump, sneak, sprint)));
        if (sprint != lastSprint) {
            lastSprint = sprint;
            listener().handlePlayerCommand(new ServerboundPlayerCommandPacket(handle(),
                    sprint ? ServerboundPlayerCommandPacket.Action.START_SPRINTING : ServerboundPlayerCommandPacket.Action.STOP_SPRINTING));
        }
    }

    public void confirmTeleport(int id, double x, double y, double z, float yaw, float pitch) {
        // Only confirm the teleport the server is waiting for right now (anything else gets you kicked)
        ServerGamePacketListenerImpl l = listener();
        try {
            if (AWAITING_POS.get(l) == null || AWAITING_ID.getInt(l) != id) return;
        } catch (IllegalAccessException e) {
            return;
        }
        Vec3 pos = (Vec3) awaitingPos(l);
        l.handleAcceptTeleportPacket(new ServerboundAcceptTeleportationPacket(id, pos.x, pos.y, pos.z, yaw, pitch));
    }

    private int awaitingTicks;

    /**
     * While a teleport is not confirmed the server ignores every move. If the browser's answer got lost
     * (e.g. the login teleport arrives before "welcome"), the player would stay there forever while the
     * browser walks on: no new chunks, stuck at the edge. Tell the browser again after 2 seconds.
     */
    private void resendLostTeleport() {
        ServerGamePacketListenerImpl l = listener();
        Vec3 pos = (Vec3) awaitingPos(l);
        if (pos == null) {
            awaitingTicks = 0;
            return;
        }
        if (++awaitingTicks < 40) return;
        awaitingTicks = 0;
        try {
            ServerPlayer sp = handle();
            session.teleported(AWAITING_ID.getInt(l), pos.x, pos.y, pos.z, sp.getYRot(), sp.getXRot());
        } catch (IllegalAccessException ignored) {
        }
    }

    private static Object awaitingPos(ServerGamePacketListenerImpl l) {
        try {
            return AWAITING_POS.get(l);
        } catch (IllegalAccessException e) {
            return null;
        }
    }

    private static final java.lang.reflect.Field DATA_SLOTS;

    static {
        try {
            DATA_SLOTS = AbstractContainerMenu.class.getDeclaredField("dataSlots");
            DATA_SLOTS.setAccessible(true);
        } catch (NoSuchFieldException e) {
            throw new IllegalStateException("WebCraft needs Minecraft 26.3 (field dataSlots missing)", e);
        }
    }

    private static final java.lang.reflect.Field AWAITING_POS = field("awaitingPositionFromClient");
    private static final java.lang.reflect.Field AWAITING_ID = field("awaitingTeleport");

    private static java.lang.reflect.Field field(String name) {
        try {
            java.lang.reflect.Field f = ServerGamePacketListenerImpl.class.getDeclaredField(name);
            f.setAccessible(true);
            return f;
        } catch (NoSuchFieldException e) {
            throw new IllegalStateException("WebCraft needs Minecraft 26.3 (field " + name + " missing)", e);
        }
    }

    // Digging is timed by the browser, but the server checks its own tick count. When the server runs
    // slower than 20 ticks per second, or the start message was late, the server would say "not done yet"
    // and the block comes back. So "stop" waits here until the server counted enough ticks.
    private long ticks;
    private BlockPos digPos;
    private int digFace;
    private long digStart;
    private long pendingStopAt = -1;

    public void dig(String action, int x, int y, int z, int face) {
        BlockPos pos = new BlockPos(x, y, z);
        switch (action) {
            case "start" -> {
                flushPendingStop();
                digPos = pos;
                digFace = face;
                digStart = ticks;
                send(ServerboundPlayerActionPacket.Action.START_DESTROY_BLOCK, pos, face);
                punch();
            }
            case "stop" -> {
                // The server checks the break speed it sees right now (falling into the hole you dig,
                // water, haste ending ...). If that is not enough yet, wait until it is, or the
                // block would come back. At most 5 s.
                if (pos.equals(digPos) && !digDone()) {
                    pendingStopAt = ticks + 100;
                } else {
                    pendingStopAt = -1;
                    send(ServerboundPlayerActionPacket.Action.STOP_DESTROY_BLOCK, pos, face);
                    digPos = null;
                }
            }
            default -> {
                pendingStopAt = -1;
                digPos = null;
                send(ServerboundPlayerActionPacket.Action.ABORT_DESTROY_BLOCK, pos, face);
            }
        }
    }

    /** Like the server's own check when digging stops: progress = speed now x ticks since start >= 0.7. */
    private boolean digDone() {
        if (digPos == null) return true;
        ServerPlayer sp = handle();
        var state = sp.level().getBlockState(digPos);
        if (state.isAir()) return true;
        float perTick = state.getDestroyProgress(sp, sp.level(), digPos);
        // one tick less than the server allows, so ticks that arrive late don't matter
        return perTick * (ticks - digStart) >= 0.7f;
    }

    private void flushPendingStop() {
        if (pendingStopAt >= 0 && digPos != null) {
            pendingStopAt = -1;
            send(ServerboundPlayerActionPacket.Action.STOP_DESTROY_BLOCK, digPos, digFace);
            digPos = null;
        }
    }

    private void send(ServerboundPlayerActionPacket.Action a, BlockPos pos, int face) {
        listener().handlePlayerAction(new ServerboundPlayerActionPacket(a, pos, direction(face), sequence++));
    }

    /** Right click on a block: open doors/chests, place blocks, use buckets ... */
    public void useOn(int x, int y, int z, int face, double hx, double hy, double hz) {
        BlockHitResult hit = new BlockHitResult(new Vec3(hx, hy, hz), direction(face), new BlockPos(x, y, z), false);
        listener().handleUseItemOn(new ServerboundUseItemOnPacket(InteractionHand.MAIN_HAND, hit, sequence++));
        swing();
    }

    /** Right click into the air: eat, drink, throw, draw a bow ... */
    public void useItem() {
        listener().handleUseItem(new ServerboundUseItemPacket(InteractionHand.MAIN_HAND, sequence++, handle().getYRot(), handle().getXRot()));
    }

    public void releaseUse() {
        listener().handlePlayerAction(new ServerboundPlayerActionPacket(
                ServerboundPlayerActionPacket.Action.RELEASE_USE_ITEM, BlockPos.ZERO, Direction.DOWN));
    }

    public void attack(int entityId) {
        listener().handleAttack(new ServerboundAttackPacket(entityId));
        punch();
    }

    /** Left click (arm swing). */
    public void punch() {
        listener().handlePunch(ServerboundPunchPacket.INSTANCE);
    }

    /** Only the arm animation (digging), like the client's swing packet. */
    public void swing() {
        ServerPlayer sp = handle();
        sp.swing(InteractionHand.MAIN_HAND, sp.getItemInHand(InteractionHand.MAIN_HAND).getAttackAnimation(), true);
    }

    /** For /webcraft status: how far the server sends chunks to this player. */
    public String chunkLoaderInfo() {
        try {
            return "view " + handle().getChunkTrackingView();
        } catch (Throwable t) {
            return "?";
        }
    }

    private static final java.lang.reflect.Field ENTITY_MAP;

    static {
        java.lang.reflect.Field f = null;
        try {
            f = net.minecraft.server.level.ChunkMap.class.getDeclaredField("entityMap");
            f.setAccessible(true);
        } catch (Exception ignored) {
        }
        ENTITY_MAP = f;
    }

    /** For /webcraft status: is this player tracked, and by how many players. */
    public String trackingInfo() {
        try {
            var map = (it.unimi.dsi.fastutil.ints.Int2ObjectMap<?>) ENTITY_MAP.get(handle().level().getChunkSource().chunkMap);
            Object tracked = map.get(handle().getId());
            if (tracked == null) return "not tracked";
            var seenBy = (java.util.Set<?>) tracked.getClass().getDeclaredField("seenBy").get(tracked);
            return "seen by " + seenBy.size();
        } catch (Throwable t) {
            return "?";
        }
    }

    public void selectSlot(int slot) {
        listener().handleSetCarriedItem(new ServerboundSetCarriedItemPacket(slot));
    }

    public void drop(boolean all) {
        listener().handlePlayerAction(new ServerboundPlayerActionPacket(
                all ? ServerboundPlayerActionPacket.Action.DROP_ALL_ITEMS : ServerboundPlayerActionPacket.Action.DROP_ITEM,
                BlockPos.ZERO, Direction.DOWN));
    }

    public void swapHands() {
        listener().handlePlayerAction(new ServerboundPlayerActionPacket(
                ServerboundPlayerActionPacket.Action.SWAP_ITEM_WITH_OFFHAND, BlockPos.ZERO, Direction.DOWN));
    }

    public void click(int slot, int button, String mode) {
        AbstractContainerMenu menu = handle().containerMenu;
        ContainerInput input = switch (mode) {
            case "quick" -> ContainerInput.QUICK_MOVE;
            case "swap" -> ContainerInput.SWAP;      // button = hotbar slot 0-8, or 40 for offhand
            case "throw" -> ContainerInput.THROW;
            default -> ContainerInput.PICKUP;
        };
        listener().handleContainerClick(new ServerboundContainerClickPacket(menu.containerId, menu.getStateId(),
                (short) slot, (byte) button, input, Int2ObjectMaps.emptyMap(), HashedStack.EMPTY));
    }

    /** Creative mode: put any item into an inventory slot (menu slot numbers, hotbar = 36..44). */
    public void creativeSet(int slot, ItemStack item) {
        listener().handleSetCreativeModeSlot(new ServerboundSetCreativeModeSlotPacket((short) slot, item == null ? ItemStack.EMPTY : item));
    }

    public void openOwnInventory() {
        listener().handlePlayerCommand(new ServerboundPlayerCommandPacket(handle(), ServerboundPlayerCommandPacket.Action.OPEN_INVENTORY));
    }

    public void closeMenu() {
        listener().handleContainerClose(new ServerboundContainerClosePacket(handle().containerMenu.containerId));
    }

    public void respawn() {
        listener().handleClientCommand(new ServerboundClientCommandPacket(ServerboundClientCommandPacket.Action.PERFORM_RESPAWN));
        listener().handleAcceptPlayerLoad(new ServerboundPlayerLoadedPacket());
    }

    /** Kicked by an admin. */
    public void kick(String reason) {
        listener().disconnect(Component.literal(reason));
    }

    /** Leave the server (browser closed). */
    public void remove() {
        if (removed) return;
        removed = true;
        try {
            connection.disconnect(new DisconnectionDetails(Component.literal("Left WebCraft")));
            connection.handleDisconnection();
        } catch (Exception e) {
            LOG.warn("Could not remove WebCraft player {}: {}", name, e.toString());
        }
    }

    // ------------------------------------------------------------------ open screen (inventory, chest, GUI)

    /** Menu currently shown by the server, or null when only the plain player inventory is active. */
    public boolean containerOpen() {
        return !(handle().containerMenu instanceof InventoryMenu);
    }

    public MenuSnapshot snapshotMenu() {
        AbstractContainerMenu menu = handle().containerMenu;
        String type;
        if (menu instanceof InventoryMenu) {
            type = "player";
        } else {
            String t;
            try {
                Identifier key = BuiltInRegistries.MENU.getKey(menu.getType());
                t = key == null ? "unknown" : key.getPath();
            } catch (Exception e) {
                t = "unknown";
            }
            type = t;
        }
        List<ItemStack> items = new ArrayList<>(menu.slots.size());
        for (int i = 0; i < menu.slots.size(); i++) items.add(menu.slots.get(i).getItem().copy());
        String title = menu instanceof InventoryMenu ? "" : menuTitle;
        return new MenuSnapshot(menu.containerId, type, title, items, menu.getCarried().copy());
    }

    public record MenuSnapshot(int id, String type, String title, List<ItemStack> slots, ItemStack carried) {}

    /** Numbers of the open screen: furnace/brewing progress and fuel, enchanting costs ... */
    public int[] menuData() {
        AbstractContainerMenu menu = handle().containerMenu;
        try {
            @SuppressWarnings("unchecked")
            List<net.minecraft.world.inventory.DataSlot> slots = (List<net.minecraft.world.inventory.DataSlot>) DATA_SLOTS.get(menu);
            int[] out = new int[slots.size()];
            for (int i = 0; i < out.length; i++) out[i] = slots.get(i).get();
            return out;
        } catch (IllegalAccessException e) {
            return new int[0];
        }
    }

    /** Villager trades, or the three enchanting offers, for the browser (null for other screens). */
    public com.google.gson.JsonObject tradesJson() {
        AbstractContainerMenu menu = handle().containerMenu;
        if (menu instanceof net.minecraft.world.inventory.MerchantMenu mm) {
            com.google.gson.JsonObject o = new com.google.gson.JsonObject();
            com.google.gson.JsonArray list = new com.google.gson.JsonArray();
            for (var offer : mm.getOffers()) {
                com.google.gson.JsonObject t = new com.google.gson.JsonObject();
                t.add("a", WcItems.json(offer.getCostA()));
                t.add("b", WcItems.json(offer.getCostB()));
                t.add("r", WcItems.json(offer.getResult()));
                t.addProperty("out", offer.isOutOfStock());
                list.add(t);
            }
            o.add("list", list);
            o.addProperty("level", mm.getTraderLevel());
            return o;
        }
        if (menu instanceof net.minecraft.world.inventory.EnchantmentMenu em) {
            com.google.gson.JsonObject o = new com.google.gson.JsonObject();
            com.google.gson.JsonArray list = new com.google.gson.JsonArray();
            var registry = handle().level().registryAccess().lookupOrThrow(net.minecraft.core.registries.Registries.ENCHANTMENT);
            for (int i = 0; i < 3; i++) {
                com.google.gson.JsonObject t = new com.google.gson.JsonObject();
                t.addProperty("cost", em.costs[i]);
                int id = em.enchantClue[i];
                String name = "";
                if (id >= 0) {
                    try {
                        int level = em.levelClue[i];
                        name = registry.get(id).map(h -> net.minecraft.world.item.enchantment.Enchantment.getFullname(h, level).getString()).orElse("");
                    } catch (RuntimeException ignored) {
                        // unknown enchantment id
                    }
                }
                t.addProperty("name", name);
                list.add(t);
            }
            o.add("enchant", list);
            o.addProperty("lapis", em.getGoldCount());
            return o;
        }
        // Stonecutter recipes, loom patterns, beacon effects
        return WcMenus.extras(handle(), menu);
    }

    /** Buttons of a screen (enchanting options, stonecutter recipe, loom pattern ...). */
    public void menuButton(int id) {
        listener().handleContainerButtonClick(new ServerboundContainerButtonClickPacket(handle().containerMenu.containerId, id));
    }

    /** Beacon "Done": primary and secondary effect (keys like "speed", empty for none). */
    public void beacon(String primary, String secondary) {
        WcMenus.setBeacon(listener(), primary, secondary);
    }

    public void selectTrade(int index) {
        listener().handleSelectTrade(new ServerboundSelectTradePacket(index));
    }

    public void rename(String name) {
        listener().handleRenameItem(new ServerboundRenameItemPacket(name == null ? "" : name));
    }

    /** Right click on an entity: trade with villagers, feed or ride animals, put on a name tag ... */
    public void interact(int entityId, double hx, double hy, double hz) {
        boolean sneaking = handle().isShiftKeyDown();
        listener().handleInteract(new ServerboundInteractPacket(entityId, InteractionHand.MAIN_HAND, new Vec3(hx, hy, hz), sneaking));
    }

    // ------------------------------------------------------------------ packets from the server

    private void onPacket(Packet<?> packet) {
        if (packet instanceof BundlePacket<?> bundle) {
            for (Packet<?> p : bundle.subPackets()) onPacket(p);
            return;
        }
        try {
            handlePacket(packet);
        } catch (Exception e) {
            LOG.warn("WebCraft: could not handle {}: {}", packet.getClass().getSimpleName(), e.toString());
        }
    }

    private void handlePacket(Packet<?> packet) {
        switch (packet) {
            case ClientboundKeepAlivePacket k -> runSync(() -> {
                if (!removed) listener().handleKeepAlive(new ServerboundKeepAlivePacket(k.getId()));
            });
            // Vanilla sends the next chunks only after the client confirmed the last batch. Without this the
            // server stops after the first batch, and block changes in the other chunks never reach the browser.
            case ClientboundChunkBatchFinishedPacket b -> runSync(() -> {
                if (!removed) listener().handleChunkBatchReceived(new ServerboundChunkBatchReceivedPacket(64f));
            });
            case ClientboundPlayerPositionPacket p -> {
                // The server already moved the player; tell the browser where it is now
                runSync(() -> {
                    if (removed) return;
                    ServerPlayer sp = handle();
                    session.teleported(p.id(), sp.getX(), sp.getY(), sp.getZ(), sp.getYRot(), sp.getXRot());
                });
            }
            case ClientboundSetEntityMotionPacket m -> {
                if (m.id() == handle().getId()) {
                    Vec3 v = m.movement();
                    session.knockback(v.x, v.y, v.z);
                }
            }
            case ClientboundExplodePacket e -> e.playerKnockback().ifPresent(v -> session.knockback(v.x, v.y, v.z));
            case ClientboundSystemChatPacket c -> {
                if (c.overlay()) session.notice(c.content().getString());
                else session.chat(c.content().getString());
            }
            case ClientboundPlayerChatPacket c -> {
                Component content = c.unsignedContent().orElse(Component.literal(c.body().content()));
                session.chat(c.chatType().decorate(content).getString());
            }
            case ClientboundDisguisedChatPacket c -> session.chat(c.chatType().decorate(c.message()).getString());
            case ClientboundSetActionBarTextPacket a -> session.notice(a.text().getString());
            case ClientboundPlayerCombatKillPacket k -> session.died(k.message().getString());
            case ClientboundSetHealthPacket h -> session.statsDirty = true;
            case ClientboundContainerSetContentPacket c -> session.invDirty = true;
            case ClientboundContainerSetSlotPacket c -> session.invDirty = true;
            case ClientboundSetCursorItemPacket c -> session.invDirty = true;
            case ClientboundSetPlayerInventoryPacket c -> session.invDirty = true;
            case ClientboundOpenScreenPacket c -> {
                menuTitle = c.getTitle().getString();
                session.invDirty = true;
            }
            case ClientboundContainerClosePacket c -> session.invDirty = true;
            // Furnace progress, the stonecutter/loom choice, beacon levels ...
            case ClientboundContainerSetDataPacket c -> session.invDirty = true;
            case ClientboundSetHeldSlotPacket c -> session.invDirty = true;
            case ClientboundSetExperiencePacket c -> session.statsDirty = true;
            case ClientboundDisconnectPacket d -> session.kicked(d.reason().getString());
            case ClientboundAnimatePacket a -> session.anims.add(new int[] {a.getId(), a.getAction()});
            case ClientboundLevelParticlesPacket fx -> session.fx.add(fx);
            case ClientboundLevelEventPacket fx -> session.fx.add(fx);
            // Every block change the server tells a normal client about (also /setblock, WorldEdit, pistons ...)
            case ClientboundBlockUpdatePacket b -> session.blockChanges.add(new Object[] {b.getPos(), b.getBlockState()});
            case ClientboundSectionBlocksUpdatePacket b -> b.runUpdates((pos, state) -> session.blockChanges.add(new Object[] {pos.immutable(), state}));
            // Since 26.x arm swings have their own packet
            case ClientboundSwingAnimationPacket a ->
                    session.anims.add(new int[] {a.entityId(), a.hand() == InteractionHand.OFF_HAND ? 3 : 0});
            case ClientboundDamageEventPacket d -> session.anims.add(new int[] {d.entityId(), 1});
            case ClientboundHurtAnimationPacket h -> session.anims.add(new int[] {h.id(), 1});
            case ClientboundSetObjectivePacket o -> session.scoreboard.objective(o);
            case ClientboundSetDisplayObjectivePacket o -> session.scoreboard.display(o);
            case ClientboundSetScorePacket o -> session.scoreboard.score(o);
            case ClientboundResetScorePacket o -> session.scoreboard.reset(o);
            case ClientboundSetPlayerTeamPacket o -> session.scoreboard.team(o);
            case ClientboundTabListPacket t -> {
                session.tabHeader = t.header().getString();
                session.tabFooter = t.footer().getString();
                session.lastTab = "";
            }
            // Holograms that mods only send as packets
            case ClientboundAddEntityPacket a -> runSync(() -> {
                if (removed || handle().level().getEntity(a.getId()) != null) return;
                String type = BuiltInRegistries.ENTITY_TYPE.getKey(a.getType()).getPath();
                session.addVirtual(a.getId(), type, a.getX(), a.getY(), a.getZ());
            });
            case ClientboundSetEntityDataPacket d -> {
                WcSession.Virtual v = session.virtualEntities.get(d.id());
                if (v != null) {
                    for (var dv : d.packedItems()) {
                        Object value = dv.value();
                        if (value instanceof java.util.Optional<?> opt) value = opt.orElse(null);
                        if (value instanceof Component c) v.text = c.getString();
                    }
                }
            }
            case ClientboundRemoveEntitiesPacket r -> r.entityIds().forEach(id -> session.virtualEntities.remove(id));
            case ClientboundTeleportEntityPacket t -> {
                WcSession.Virtual v = session.virtualEntities.get(t.id());
                if (v != null && t.relatives().isEmpty()) {
                    Vec3 pos = t.change().position();
                    v.x = pos.x;
                    v.y = pos.y;
                    v.z = pos.z;
                }
            }
            default -> { }
        }
    }

    private void onDisconnect(DisconnectionDetails details) {
        if (removed) return;
        removed = true;
        // Kicked or banned by the server (or a mod)
        session.kicked(details.reason().getString());
        runSync(connection::handleDisconnection);
    }

    private void runSync(Runnable r) {
        mod.runSync(r);
    }

    private static Direction direction(int face) {
        Direction[] all = Direction.values();
        return all[Math.floorMod(face, all.length)];
    }

    // ------------------------------------------------------------------ connection without a network

    static final class FakeConnection extends Connection {
        private final WcFakePlayer owner;
        private boolean disconnectNotified;
        EmbeddedChannel embedded;

        FakeConnection(WcFakePlayer owner) {
            super(PacketFlow.SERVERBOUND);
            this.owner = owner;
        }

        /** Vanilla keeps channel and address private (Paper made them public). */
        void init(EmbeddedChannel channel, SocketAddress address) {
            embedded = channel;
            try {
                java.lang.reflect.Field c = Connection.class.getDeclaredField("channel");
                c.setAccessible(true);
                c.set(this, channel);
                java.lang.reflect.Field a = Connection.class.getDeclaredField("address");
                a.setAccessible(true);
                a.set(this, address);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException("WebCraft needs Minecraft 26.3 (Connection fields missing)", e);
            }
        }

        @Override
        public void send(Packet<?> packet) {
            owner.onPacket(packet);
        }

        @Override
        public void send(Packet<?> packet, ChannelFutureListener listener) {
            owner.onPacket(packet);
        }

        @Override
        public void send(Packet<?> packet, ChannelFutureListener listener, boolean flush) {
            owner.onPacket(packet);
        }

        @Override
        public void flushChannel() {
        }

        @Override
        public void disconnect(DisconnectionDetails details) {
            super.disconnect(details);
            if (!disconnectNotified) {
                disconnectNotified = true;
                owner.onDisconnect(details);
            }
        }
    }
}
