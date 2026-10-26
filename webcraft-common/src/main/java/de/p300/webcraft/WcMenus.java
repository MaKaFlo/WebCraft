package de.p300.webcraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.network.protocol.game.ServerboundSetBeaconPacket;
import net.minecraft.util.context.ContextMap;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.BeaconMenu;
import net.minecraft.world.inventory.LoomMenu;
import net.minecraft.world.inventory.StonecutterMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.display.SlotDisplayContext;
import net.minecraft.world.level.block.entity.BannerPattern;
import net.minecraft.world.level.block.entity.BeaconBlockEntity;

import java.util.List;
import java.util.Optional;

/**
 * Screens where you choose something: stonecutter recipes, loom patterns, beacon effects.
 * Plain Minecraft code, used by the Paper plugin and the Fabric mod.
 */
final class WcMenus {

    private WcMenus() {}

    /** What the browser needs to show the choices of the open screen, or null for other screens. */
    static JsonObject extras(ServerPlayer player, AbstractContainerMenu menu) {
        if (menu instanceof StonecutterMenu sm) {
            // The recipes for the stone in the input slot; the button id is the index in this list
            ContextMap ctx = SlotDisplayContext.fromLevel(player.level());
            JsonArray list = new JsonArray();
            for (var entry : sm.getVisibleRecipes().entries()) {
                ItemStack result = entry.recipe().optionDisplay().resolveForFirstStack(ctx);
                JsonObject it = new JsonObject();
                it.addProperty("k", result.isEmpty() ? "barrier" : BuiltInRegistries.ITEM.getKey(result.getItem()).getPath());
                it.addProperty("c", Math.max(1, result.getCount()));
                list.add(it);
            }
            JsonObject o = new JsonObject();
            o.add("cut", list);
            o.addProperty("sel", sm.getSelectedRecipeIndex());
            return o;
        }
        if (menu instanceof LoomMenu lm) {
            // Patterns that fit the banner and dye (and the pattern item); the button id is the index
            JsonArray list = new JsonArray();
            for (Holder<BannerPattern> p : lm.getSelectablePatterns()) {
                list.add(p.unwrapKey().map(k -> k.identifier().getPath()).orElse("?"));
            }
            JsonObject o = new JsonObject();
            o.add("patterns", list);
            o.addProperty("sel", lm.getSelectedBannerPatternIndex());
            return o;
        }
        if (menu instanceof BeaconMenu bm) {
            JsonObject o = new JsonObject();
            o.addProperty("levels", bm.getLevels());
            o.addProperty("pay", bm.hasPayment());
            if (bm.getPrimaryEffect() != null) o.addProperty("primary", effectKey(bm.getPrimaryEffect()));
            if (bm.getSecondaryEffect() != null) o.addProperty("secondary", effectKey(bm.getSecondaryEffect()));
            // Effects per pyramid level (1: speed, haste; 2: resistance, jump; 3: strength; 4: regeneration)
            JsonArray tiers = new JsonArray();
            for (List<Holder<MobEffect>> tier : BeaconBlockEntity.BEACON_EFFECTS) {
                JsonArray t = new JsonArray();
                for (Holder<MobEffect> e : tier) t.add(effectKey(e));
                tiers.add(t);
            }
            o.add("tiers", tiers);
            JsonObject wrap = new JsonObject();
            wrap.add("beacon", o);
            return wrap;
        }
        return null;
    }

    /** "Done" in the beacon screen: like the client's packet (the server checks levels and payment). */
    static void setBeacon(ServerGamePacketListenerImpl listener, String primary, String secondary) {
        listener.handleSetBeaconPacket(new ServerboundSetBeaconPacket(effect(primary), effect(secondary)));
    }

    private static String effectKey(Holder<MobEffect> effect) {
        return effect.unwrapKey().map(k -> k.identifier().getPath()).orElse("?");
    }

    private static Optional<Holder<MobEffect>> effect(String key) {
        if (key == null || key.isEmpty()) return Optional.empty();
        Identifier id = Identifier.tryParse(key);
        if (id == null) return Optional.empty();
        return BuiltInRegistries.MOB_EFFECT.get(id).map(h -> (Holder<MobEffect>) h);
    }
}
