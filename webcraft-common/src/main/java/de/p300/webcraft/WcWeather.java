package de.p300.webcraft;

import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.biome.Biome;

/** Weather around a player for the `time` message: rain and thunder strength, rain or snow in its biome. */
final class WcWeather {

    private WcWeather() {}

    static void addTo(JsonObject m, ServerPlayer p) {
        Level level = p.level();
        float rain = level.getRainLevel(1f);
        if (rain <= 0.01f) return;
        m.addProperty("rain", Math.round(rain * 100) / 100.0);
        float thunder = level.getThunderLevel(1f);
        if (thunder > 0.01f) m.addProperty("thunder", Math.round(thunder * 100) / 100.0);
        BlockPos pos = p.blockPosition();
        Biome.Precipitation pr = level.getBiome(pos).value().getPrecipitationAt(pos, level.getSeaLevel());
        if (pr == Biome.Precipitation.SNOW) m.addProperty("snow", true);
        else if (pr == Biome.Precipitation.NONE) m.addProperty("dry", true);
    }
}
