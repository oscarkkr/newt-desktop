import assert from "node:assert/strict";
import { contentWarningLabel, normalizeContentWarning } from "../web/content-warning.js";

assert.equal(normalizeContentWarning(null), "");
assert.equal(normalizeContentWarning("  性相关  "), "性相关");
assert.equal(normalizeContentWarning("高浓度\n负面情绪"), "高浓度 负面情绪");
assert.equal(contentWarningLabel("性相关"), "内容预警 · 性相关");
assert.equal(contentWarningLabel(""), "");

console.log("Content warning labels: OK");
