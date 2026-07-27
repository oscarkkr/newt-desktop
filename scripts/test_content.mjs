import assert from "node:assert/strict";
import {
  contentSummary,
  isSafeImageUrl,
  isSafeLinkUrl,
  markdownPlainText,
  markdownToHtml,
  parsePostContent
} from "../web/content.js";

const parsed = parsePostContent(
  "#727060\n\n正文在这里\n\n![](https://file.tholeapis.top/file.example.png)"
);
assert.deepEqual(parsed.quotePids, [727060]);
assert.equal(parsed.images.length, 1);
assert.equal(parsed.images[0].url, "https://file.tholeapis.top/file.example.png");
assert.equal(contentSummary("#727060\n\n正文在这里"), "正文在这里");

const ordinaryMention = parsePostContent("正文中提到 #727060，句尾还有 #727061");
assert.deepEqual(ordinaryMention.quotePids, [727060, 727061]);
assert.match(ordinaryMention.body, /#727060/);

const duplicateQuote = parsePostContent("#727060\n再次提到 #727060\n#727061");
assert.deepEqual(duplicateQuote.quotePids, [727060, 727061]);

assert.equal(isSafeImageUrl("https://file.tholeapis.top/file.png"), true);
assert.equal(isSafeImageUrl("http://file.tholeapis.top/file.png"), false);
assert.equal(isSafeImageUrl("javascript:alert(1)"), false);

const markdown = markdownToHtml(`# 一级标题

正文有 **粗体**、*斜体*、~~删除线~~、\`代码\`和[安全链接](https://example.com)。

> 引用文字

- 第一项
- 第二项

| 名称 | 数量 |
| :--- | ---: |
| 苹果 | 2 |

\`\`\`js
const safe = "<script>";
\`\`\``);
assert.match(markdown, /<h3>一级标题<\/h3>/);
assert.match(markdown, /<strong>粗体<\/strong>/);
assert.match(markdown, /<em>斜体<\/em>/);
assert.match(markdown, /<del>删除线<\/del>/);
assert.match(markdown, /<blockquote><p>引用文字<\/p><\/blockquote>/);
assert.match(markdown, /<ul><li>第一项<\/li><li>第二项<\/li><\/ul>/);
assert.match(markdown, /<table>/);
assert.match(markdown, /href="https:\/\/example.com"/);
assert.match(markdown, /&lt;script&gt;/);
assert.doesNotMatch(markdown, /<script>/);
assert.match(markdownToHtml("直接访问 https://example.com/path。"), /href="https:\/\/example.com\/path"/);

const unsafe = markdownToHtml(`<img src=x onerror=alert(1)>
[危险](javascript:alert(1))`);
assert.match(unsafe, /&lt;img/);
assert.doesNotMatch(unsafe, /href=/);
assert.equal(isSafeLinkUrl("https://example.com"), true);
assert.equal(isSafeLinkUrl("javascript:alert(1)"), false);
assert.equal(markdownPlainText("# 标题\n\n**正文**"), "标题\n\n正文");
assert.equal(contentSummary("# 标题\n\n**正文**"), "标题 正文");

console.log("Rich post content: OK");
