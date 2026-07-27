import assert from "node:assert/strict";
import { sortNewestFirst } from "../web/post-order.js";

const firstPage = [
  { pid: 120, timestamp: 10 },
  { pid: 150, timestamp: 30 },
];
const secondPage = [
  { pid: 130, timestamp: 20 },
  { pid: 110, timestamp: 40 },
];

assert.deepEqual(
  sortNewestFirst([...firstPage, ...secondPage]).map((post) => post.pid),
  [150, 130, 120, 110],
);
assert.deepEqual(
  sortNewestFirst([
    { timestamp: 10 },
    { timestamp: 30 },
  ]).map((post) => post.timestamp),
  [30, 10],
);

console.log("Search result ordering: OK");
