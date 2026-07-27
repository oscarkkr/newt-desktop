import assert from "node:assert/strict";
import { commentWithReply, replyPrefix, replyTargetFor } from "../web/reply.js";

const alice = replyTargetFor({ cid: 101, name_id: 1 }, 1);
assert.deepEqual(alice, { key: "101", floor: 1, nickname: "Alice" });
assert.equal(replyPrefix(alice), "Re Alice: ");
assert.equal(commentWithReply("你好", alice), "Re Alice: 你好");
assert.equal(commentWithReply(" Re Alice: 你好 ", alice), "Re Alice: 你好");

const owner = replyTargetFor({ name_id: 0 }, 3);
assert.deepEqual(owner, { key: "floor-3", floor: 3, nickname: "洞主" });
assert.equal(commentWithReply("收到", owner), "Re 洞主: 收到");

const secondRound = replyTargetFor({ cid: 202, name_id: 27 }, 4);
assert.equal(commentWithReply("欢迎", secondRound), "Re Alice 2: 欢迎");
assert.equal(commentWithReply("普通评论", null), "普通评论");

const sanitized = replyTargetFor({ name_id: "Alice:\nInjected" }, 5);
assert.equal(commentWithReply("安全", sanitized), "Re Alice Injected: 安全");

console.log("Targeted comment replies: OK");
