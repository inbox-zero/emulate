import type { RouteContext } from "@internal/core";
import type { Context } from "hono";
import {
  createDraftMessage,
  deleteDraftMessage,
  formatDraftResource,
  getDraftById,
  getDraftMessage,
  gmailError,
  listDraftsForUser,
  normalizeLimit,
  parseFormat,
  parseOffset,
  sendDraftMessage,
  updateDraftMessage,
} from "../helpers.js";
import { getRecord, getString, parseGoogleBody, requireGmailUser } from "../route-helpers.js";
import { getGoogleStore } from "../store.js";

export function draftRoutes({ app, store }: RouteContext): void {
  const gs = getGoogleStore(store);

  const createHandler = async (c: Context) => {
    const authEmail = requireGmailUser(c);
    if (authEmail instanceof Response) return authEmail;

    const body = await parseGoogleBody(c);
    const messageBody = getRecord(body, "message") ?? body;
    const raw = getString(messageBody, "raw");

    try {
      const { draft } = createDraftMessage(gs, {
        user_email: authEmail,
        raw,
        thread_id: getString(messageBody, "threadId", "thread_id"),
        from: getString(messageBody, "from") ?? authEmail,
        to: getString(messageBody, "to"),
        cc: getString(messageBody, "cc") ?? null,
        bcc: getString(messageBody, "bcc") ?? null,
        reply_to: getString(messageBody, "replyTo", "reply_to") ?? null,
        subject: getString(messageBody, "subject"),
        snippet: getString(messageBody, "snippet"),
        body_text: getString(messageBody, "body_text", "text") ?? null,
        body_html: getString(messageBody, "body_html", "html") ?? null,
        date: getString(messageBody, "date"),
        internal_date: getString(messageBody, "internalDate", "internal_date"),
        message_id: getString(messageBody, "messageId", "message_id"),
        references: getString(messageBody, "references") ?? null,
        in_reply_to: getString(messageBody, "inReplyTo", "in_reply_to") ?? null,
      });

      return c.json(formatDraftResource(gs, draft, "full"));
    } catch {
      return gmailError(
        c,
        400,
        "Invalid raw MIME message payload.",
        "invalidArgument",
        "INVALID_ARGUMENT",
      );
    }
  };

  const sendHandler = async (c: Context) => {
    const authEmail = requireGmailUser(c);
    if (authEmail instanceof Response) return authEmail;

    const body = await parseGoogleBody(c);
    const draftId = getString(body, "id") ?? getString(getRecord(body, "draft") ?? {}, "id");
    if (!draftId) {
      return gmailError(c, 400, "Draft ID is required.", "invalidArgument", "INVALID_ARGUMENT");
    }

    const draft = getDraftById(gs, authEmail, draftId);
    if (!draft) {
      return gmailError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const message = sendDraftMessage(gs, draft);
    if (!message) {
      return gmailError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    return c.json({
      id: message.gmail_id,
      threadId: message.thread_id,
      labelIds: message.label_ids,
      snippet: message.snippet,
      historyId: message.history_id,
      internalDate: message.internal_date,
    });
  };

  app.get("/gmail/v1/users/:userId/drafts", (c) => {
    const authEmail = requireGmailUser(c);
    if (authEmail instanceof Response) return authEmail;

    const drafts = listDraftsForUser(gs, authEmail);
    const url = new URL(c.req.url);
    const offset = parseOffset(url.searchParams.get("pageToken"));
    const limit = normalizeLimit(url.searchParams.get("maxResults"), 100, 500);
    const page = drafts.slice(offset, offset + limit);
    const nextPageToken = offset + limit < drafts.length ? String(offset + limit) : undefined;

    return c.json({
      drafts: page.map((draft) => {
        const resource = formatDraftResource(gs, draft, "minimal") as {
          id: string;
          message?: { id: string; threadId: string };
        };
        return {
          id: resource.id,
          message: resource.message
            ? {
                id: resource.message.id,
                threadId: resource.message.threadId,
              }
            : undefined,
        };
      }),
      nextPageToken,
      resultSizeEstimate: drafts.length,
    });
  });

  app.post("/gmail/v1/users/:userId/drafts", createHandler);
  app.post("/upload/gmail/v1/users/:userId/drafts", createHandler);

  app.get("/gmail/v1/users/:userId/drafts/:id", (c) => {
    const authEmail = requireGmailUser(c);
    if (authEmail instanceof Response) return authEmail;

    const draft = getDraftById(gs, authEmail, c.req.param("id"));
    if (!draft) {
      return gmailError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    if (!getDraftMessage(gs, draft)) {
      return gmailError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const url = new URL(c.req.url);
    return c.json(
      formatDraftResource(
        gs,
        draft,
        parseFormat(url.searchParams.get("format")),
        url.searchParams.getAll("metadataHeaders"),
      ),
    );
  });

  app.put("/gmail/v1/users/:userId/drafts/:id", async (c) => {
    const authEmail = requireGmailUser(c);
    if (authEmail instanceof Response) return authEmail;

    const draft = getDraftById(gs, authEmail, c.req.param("id"));
    if (!draft) {
      return gmailError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const body = await parseGoogleBody(c);
    const messageBody = getRecord(body, "message") ?? body;

    try {
      const updated = updateDraftMessage(gs, draft, {
        raw: getString(messageBody, "raw"),
        thread_id: getString(messageBody, "threadId", "thread_id"),
        from: getString(messageBody, "from"),
        to: getString(messageBody, "to"),
        cc: getString(messageBody, "cc") ?? null,
        bcc: getString(messageBody, "bcc") ?? null,
        reply_to: getString(messageBody, "replyTo", "reply_to") ?? null,
        subject: getString(messageBody, "subject"),
        snippet: getString(messageBody, "snippet"),
        body_text: getString(messageBody, "body_text", "text") ?? null,
        body_html: getString(messageBody, "body_html", "html") ?? null,
        date: getString(messageBody, "date"),
        internal_date: getString(messageBody, "internalDate", "internal_date"),
        message_id: getString(messageBody, "messageId", "message_id"),
        references: getString(messageBody, "references") ?? null,
        in_reply_to: getString(messageBody, "inReplyTo", "in_reply_to") ?? null,
      });

      if (!updated) {
        return gmailError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
      }

      return c.json(formatDraftResource(gs, updated.draft, "full"));
    } catch {
      return gmailError(
        c,
        400,
        "Invalid raw MIME message payload.",
        "invalidArgument",
        "INVALID_ARGUMENT",
      );
    }
  });

  app.post("/gmail/v1/users/:userId/drafts/send", sendHandler);
  app.post("/upload/gmail/v1/users/:userId/drafts/send", sendHandler);

  app.delete("/gmail/v1/users/:userId/drafts/:id", (c) => {
    const authEmail = requireGmailUser(c);
    if (authEmail instanceof Response) return authEmail;

    const draft = getDraftById(gs, authEmail, c.req.param("id"));
    if (!draft) {
      return gmailError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    deleteDraftMessage(gs, draft);
    return c.body(null, 204);
  });
}
