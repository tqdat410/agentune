// MCP server setup — registers tools and handles agent communication via stdio or HTTP

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { type IncomingMessage, type ServerResponse } from "http";
import { z } from "zod";
import {
  handleAddSong,
  handlePlaySong,
  handleDiscover,
  handlePause,
  handleResume,
  handleSkip,
  handleQueueList,
  handleNowPlaying,
  handleVolume,
  handleHistory,
  handleGetSessionState,
  handleUpdatePersona,
} from "./tool-handlers.js";

/** Register all MCP tools onto a server instance */
export function registerMcpTools(server: McpServer): void {
  server.tool(
    "play_song",
    "Play a specific song immediately using title and artist. " +
    "Apple Search API is used first to clean up the canonical song identity, then YouTube resolves a playable version. " +
    "This replaces the current song right away.",
    {
      title: z.string().min(1).describe("Song title"),
      artist: z.string().optional().describe("Artist name — strongly recommended for accuracy"),
    },
    async (args) => handlePlaySong(args),
  );

  server.tool(
    "add_song",
    "Add a specific song to the queue using title and artist. " +
    "Apple Search API is used first to clean up the canonical song identity, then YouTube is used only to resolve a playable version. " +
    "If nothing is currently playing, the queued song starts automatically.",
    {
      title: z.string().min(1).describe("Song title"),
      artist: z.string().optional().describe("Artist name — strongly recommended for accuracy"),
    },
    async (args) => handleAddSong(args),
  );

  server.tool(
    "discover",
    "Get song suggestions grouped by 4 lanes: continuation (same artist), comfort (favorites), " +
    "context-fit (matching tags/mood), wildcard (new discoveries). " +
    "Call get_session_state() first to understand taste, then pass an optional music intent. " +
    "Pick from candidates and use add_song() to queue or play_song() to replace current track. " +
    "Call again for fresh suggestions.",
    {
      mode: z.enum(["focus", "balanced", "explore"]).optional().default("balanced")
        .describe("focus=predictable, balanced=default, explore=adventurous"),
      intent: z.object({
        energy: z.number().min(0).max(1).optional().describe("0=calm, 1=energetic"),
        valence: z.number().min(0).max(1).optional().describe("0=dark, 1=bright"),
        novelty: z.number().min(0).max(1).optional().describe("0=familiar, 1=new"),
        allowed_tags: z.array(z.string()).optional().describe("Tags to favor"),
        avoid_tags: z.array(z.string()).optional().describe("Tags to avoid"),
      }).optional().describe("Music intent — omit to auto-infer from taste state"),
    },
    async (args) => handleDiscover(args),
  );

  server.tool("pause", "Pause the currently playing track", {}, async () => handlePause());
  server.tool("resume", "Resume playback of a paused track", {}, async () => handleResume());
  server.tool("skip", "Skip to the next track in the queue", {}, async () => handleSkip());

  server.tool(
    "queue_list",
    "List all tracks currently in the play queue and the current now-playing track",
    {},
    async () => handleQueueList(),
  );

  server.tool(
    "now_playing",
    "Get info about the currently playing track",
    {},
    async () => handleNowPlaying(),
  );

  server.tool(
    "volume",
    "Get or set the playback volume (0-100)",
    {
      level: z.number().min(0).max(100).optional().describe("Volume level 0-100. Omit to get current volume."),
    },
    async (args) => handleVolume(args),
  );

  server.tool(
    "history",
    "View your listening history. Shows recently played tracks with play counts and skip rates. Use this to understand listening patterns before choosing what to play next.",
    {
      limit: z.number().min(1).max(50).optional().default(20).describe("Max results to return (1-50)"),
      query: z.string().optional().describe("Filter by track title or artist name"),
    },
    async (args) => handleHistory(args),
  );

  server.tool(
    "get_session_state",
    "Read current context, persona, and listening history. " +
    "Returns: time context (hour/period/day), persona (3 behavioral traits + taste text), " +
    "and history (recent plays + top artists/tags stats). " +
    "Use this to understand the listener's taste before calling discover(). " +
    "Update persona taste text via update_persona() when you learn new preferences.",
    {},
    async () => handleGetSessionState(),
  );

  server.tool(
    "update_persona",
    "Update the listener's music taste description. Call this when the user explicitly mentions " +
    "a music preference, or when you want to record taste insights learned from listening patterns. " +
    "The taste text is free-form natural language describing what genres, artists, moods, and " +
    "styles the listener prefers. This persists across sessions.",
    {
      taste: z.string().max(1000).describe(
        "Free text taste description, e.g. 'Likes ambient, piano, post-rock. Evenings prefer acoustic.'. Use an empty string to clear it."
      ),
    },
    async (args) => handleUpdatePersona(args),
  );
}

/** Create MCP server with stdio transport (legacy/direct mode) */
export async function createStdioMcpServer(): Promise<McpServer> {
  const server = new McpServer({ name: "sbotify", version: "0.1.0" });
  registerMcpTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[sbotify] MCP server started on stdio");
  return server;
}

// --- HTTP MCP handler ---

function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((msg) => (msg as Record<string, unknown>)?.method === 'initialize');
  }
  return (body as Record<string, unknown>)?.method === 'initialize';
}

/** Session lifecycle callbacks for daemon idle-shutdown */
export interface McpSessionCallbacks {
  onSessionCreated?: () => void;
  onAllSessionsClosed?: () => void;
}

/** Create an HTTP MCP handler for daemon mode — manages per-session transports */
export function createHttpMcpHandler(callbacks?: McpSessionCallbacks): {
  handleRequest: (req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void>;
  close: () => Promise<void>;
} {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  let hadSession = false;

  return {
    async handleRequest(req, res, body) {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (req.method === 'POST' && !sessionId && isInitializeRequest(body)) {
        // New session — create transport + server
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, transport);
            hadSession = true;
            callbacks?.onSessionCreated?.();
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
          if (sessions.size === 0 && hadSession) {
            callbacks?.onAllSessionsClosed?.();
          }
        };
        try {
          const server = new McpServer({ name: 'sbotify', version: '0.1.0' });
          registerMcpTools(server);
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
        } catch (err) {
          await transport.close().catch(() => {});
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to create session' }));
          }
        }
      } else if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.handleRequest(req, res, body);
      } else if (req.method === 'POST' && sessionId && !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired session' }));
      } else if (req.method === 'POST') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing session ID or initialize request' }));
      } else {
        res.writeHead(405);
        res.end('Method Not Allowed');
      }
    },
    async close() {
      for (const [sid, transport] of sessions) {
        await transport.close();
        sessions.delete(sid);
      }
    },
  };
}
