function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sortNewestFirst(posts) {
  return [...posts].sort((left, right) => {
    const rightPid = numeric(right.pid);
    const leftPid = numeric(left.pid);
    if (rightPid !== null && leftPid !== null && rightPid !== leftPid) {
      return rightPid - leftPid;
    }

    const rightTime = numeric(right.timestamp ?? right.create_time, 0);
    const leftTime = numeric(left.timestamp ?? left.create_time, 0);
    return rightTime - leftTime;
  });
}
