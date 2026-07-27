const ANONYMOUS_NAMES = [
  "Alice",
  "Bob",
  "Carol",
  "Dave",
  "Eve",
  "Francis",
  "Grace",
  "Hans",
  "Isabella",
  "Jason",
  "Kate",
  "Louis",
  "Marguerite",
  "Nathan",
  "Olivia",
  "Paul",
  "Queen",
  "Richard",
  "Susan",
  "Thomas",
  "Uma",
  "Vivian",
  "Winnie",
  "Xavier",
  "Yasmine",
  "Zach",
];

export function nicknameFor(nameId) {
  if (nameId === null || nameId === undefined || nameId === "") return "匿名";

  const raw = String(nameId).trim();
  if (!/^\d+$/.test(raw)) return raw;

  const numericId = Number(raw);
  if (!Number.isSafeInteger(numericId) || numericId < 0) return raw;
  if (numericId === 0) return "洞主";

  const index = (numericId - 1) % ANONYMOUS_NAMES.length;
  const round = Math.floor((numericId - 1) / ANONYMOUS_NAMES.length) + 1;
  const name = ANONYMOUS_NAMES[index];
  return round === 1 ? name : `${name} ${round}`;
}
