import assert from "node:assert/strict";
import { applyVote, normalizePoll, pollPercent, pollTotal } from "../web/poll.js";

const poll = {
  answers: [
    { option: "选项 A", votes: 3 },
    { option: "选项 B", votes: 1 },
  ],
  vote: null,
};

assert.equal(pollTotal(poll), 4);
assert.equal(pollPercent(3, 4), 75);
assert.equal(pollPercent(0, 0), 0);
assert.deepEqual(applyVote(poll, "选项 B"), {
  vote: "选项 B",
  answers: [
    { option: "选项 A", votes: 3 },
    { option: "选项 B", votes: 2 },
  ],
});
assert.deepEqual(normalizePoll({ answers: [{ option: "", votes: -2 }] }).answers, []);

console.log("Poll rendering data: OK");
