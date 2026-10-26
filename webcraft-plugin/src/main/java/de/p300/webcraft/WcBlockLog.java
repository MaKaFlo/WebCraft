package de.p300.webcraft;

import org.bukkit.block.Block;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.logging.Level;
import java.util.logging.Logger;

/** Appends every block a WebCraft player breaks or places to a CSV file (handy against griefing). */
final class WcBlockLog {

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final File file;
    private final Logger logger;

    WcBlockLog(File file, Logger logger) {
        this.file = file;
        this.logger = logger;
    }

    void log(String player, String action, Block b) {
        String line = String.join(",", LocalDateTime.now().format(TIME), player, action, b.getWorld().getName(),
                String.valueOf(b.getX()), String.valueOf(b.getY()), String.valueOf(b.getZ()),
                b.getType().getKey().getKey()) + "\n";
        try {
            file.getParentFile().mkdirs();
            Files.writeString(file.toPath(), line, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            logger.log(Level.WARNING, "Could not write blocklog.csv", e);
        }
    }
}
