export function normalizePoll(value) {
  const answers = Array.isArray(value?.answers)
    ? value.answers
        .filter(answer => typeof answer?.option === "string" && answer.option.trim())
        .map(answer => ({
          option: answer.option,
          votes: Math.max(0, Number(answer.votes) || 0),
        }))
    : [];
  return {
    answers,
    vote: typeof value?.vote === "string" && value.vote ? value.vote : null,
  };
}

export function pollTotal(value) {
  return normalizePoll(value).answers.reduce((sum, answer) => sum + answer.votes, 0);
}

export function pollPercent(votes, total) {
  if (!total) return 0;
  return Math.round((Math.max(0, Number(votes) || 0) / total) * 100);
}

export function applyVote(value, option) {
  const poll = normalizePoll(value);
  return {
    vote: option,
    answers: poll.answers.map(answer => ({
      ...answer,
      votes: answer.option === option ? answer.votes + 1 : answer.votes,
    })),
  };
}
