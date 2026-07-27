import assert from "node:assert/strict";
import { nicknameFor } from "../web/nicknames.js";

assert.equal(nicknameFor(0), "洞主");
assert.equal(nicknameFor(1), "Alice");
assert.equal(nicknameFor("2"), "Bob");
assert.equal(nicknameFor(3), "Carol");
assert.equal(nicknameFor(26), "Zach");
assert.equal(nicknameFor(27), "Alice 2");
assert.equal(nicknameFor("洞主"), "洞主");
assert.equal(nicknameFor(null), "匿名");

console.log("Nickname mapping: OK");
