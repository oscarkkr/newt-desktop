import { nicknameFor } from "./nicknames.js";

function safeReplyName(value) {
  return String(value ?? "")
    .replace(/[\r\n:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "匿名";
}

export function replyTargetFor(comment, floor) {
  const numericFloor = Math.max(1, Number(floor) || 1);
  return {
    key: comment?.cid === null || comment?.cid === undefined ? `floor-${numericFloor}` : String(comment.cid),
    floor: numericFloor,
    nickname: safeReplyName(nicknameFor(comment?.name_id)),
  };
}

export function replyPrefix(target) {
  return target ? `Re ${safeReplyName(target.nickname)}: ` : "";
}

export function commentWithReply(value, target) {
  const body = String(value ?? "").trim();
  if (!body || !target) return body;
  const prefix = replyPrefix(target);
  return body.startsWith(prefix) ? body : `${prefix}${body}`;
}
