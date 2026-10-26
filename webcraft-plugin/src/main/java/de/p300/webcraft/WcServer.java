package de.p300.webcraft;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bukkit.Bukkit;
import org.java_websocket.WebSocket;
import org.java_websocket.drafts.Draft;
import org.java_websocket.exceptions.InvalidDataException;
import org.java_websocket.framing.CloseFrame;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.handshake.ServerHandshakeBuilder;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.logging.Level;

/**
 * WebSocket endpoint for browser clients.
 * Runs on its own threads; every game action is handed over to the main server thread.
 */
public final class WcServer extends WebSocketServer {

    private static final int MAX_TEXT_LENGTH = 4096;

    private final WcPlugin plugin;
    private final List<String> allowedOrigins;

    public WcServer(WcPlugin plugin, InetSocketAddress address, List<String> allowedOrigins) {
        super(address);
        this.plugin = plugin;
        this.allowedOrigins = allowedOrigins;
        setReuseAddr(true);
        setConnectionLostTimeout(30);
    }

    @Override
    public ServerHandshakeBuilder onWebsocketHandshakeReceivedAsServer(WebSocket conn, Draft draft, ClientHandshake request)
            throws InvalidDataException {
        ServerHandshakeBuilder builder = super.onWebsocketHandshakeReceivedAsServer(conn, draft, request);
        if (!allowedOrigins.isEmpty()) {
            String origin = request.getFieldValue("Origin");
            if (origin == null || !allowedOrigins.contains(origin)) {
                throw new InvalidDataException(CloseFrame.POLICY_VALIDATION, "Origin not allowed");
            }
        }
        return builder;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        WcSession session = new WcSession(conn);
        conn.setAttachment(session);
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        WcSession session = conn.getAttachment();
        if (session == null) return;
        session.closed = true;
        runSync(() -> plugin.handleDisconnect(session));
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        WcSession session = conn.getAttachment();
        if (session == null || message.length() > MAX_TEXT_LENGTH) {
            conn.close(CloseFrame.POLICY_VALIDATION, "Message too large");
            return;
        }
        JsonObject json;
        try {
            json = JsonParser.parseString(message).getAsJsonObject();
        } catch (Exception e) {
            return; // ignore garbage
        }
        runSync(() -> plugin.handleMessage(session, json));
    }

    @Override
    public void onMessage(WebSocket conn, ByteBuffer message) {
        // Clients do not send binary data in this version.
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        if (conn == null) {
            plugin.getLogger().log(Level.SEVERE, "WebCraft WebSocket server error", ex);
        }
    }

    @Override
    public void onStart() {
        plugin.getLogger().info("WebCraft WebSocket server listening on " + getAddress());
    }

    private void runSync(Runnable r) {
        if (!plugin.isEnabled()) return;
        try {
            Bukkit.getScheduler().runTask(plugin, r);
        } catch (IllegalStateException ignored) {
            // plugin is shutting down
        }
    }
}
