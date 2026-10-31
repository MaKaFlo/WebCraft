package de.p300.webcraft;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
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
    /** A texture pack upload (base64 of at most WcTextures.MAX_ZIP_BYTES) is the only big message. */
    private static final int MAX_UPLOAD_LENGTH = WcTextures.MAX_ZIP_BYTES / 3 * 4 + 1024;

    private final WcHost host;
    private final List<String> allowedOrigins;

    public WcServer(WcHost host, InetSocketAddress address, List<String> allowedOrigins) {
        super(address);
        this.host = host;
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
        WcVoice voice = WcVoice.instance;
        if (voice != null) voice.leave(session);
        host.runSync(() -> host.handleDisconnect(session));
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        WcSession session = conn.getAttachment();
        int max = message.startsWith("{\"t\":\"pack_upload\"") ? MAX_UPLOAD_LENGTH : MAX_TEXT_LENGTH;
        if (session == null || message.length() > max) {
            conn.close(CloseFrame.POLICY_VALIDATION, "Message too large");
            return;
        }
        JsonObject json;
        try {
            json = JsonParser.parseString(message).getAsJsonObject();
        } catch (Exception e) {
            return; // ignore garbage
        }
        // Voice chat state and groups don't need the server thread
        String t = json.has("t") ? json.get("t").getAsString() : "";
        if (t.equals("voice") || t.equals("vgroup")) {
            WcVoice voice = WcVoice.instance;
            if (voice != null) voice.handle(session, json);
            return;
        }
        host.runSync(() -> host.handleMessage(session, json));
    }

    @Override
    public void onMessage(WebSocket conn, ByteBuffer message) {
        // Type 3: an Opus frame of the microphone (voice chat), handled right here, not on the server thread
        WcSession session = conn.getAttachment();
        WcVoice voice = WcVoice.instance;
        if (session == null || voice == null || message.remaining() < 1 || message.remaining() > 1500) return;
        if (message.get() == 3) voice.mic(session, message);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        if (conn == null) {
            host.logger().log(Level.SEVERE, "WebCraft WebSocket server error", ex);
        }
    }

    @Override
    public void onStart() {
        host.logger().info("WebCraft WebSocket server listening on " + getAddress());
    }
}
