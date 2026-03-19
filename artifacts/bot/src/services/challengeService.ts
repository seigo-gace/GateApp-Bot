export interface ChallengeQuestion {
  text: string;
  options: string[];
  correctIndex: number;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function makeWrongs(answer: number, count: number, min: number, max: number): number[] {
  const wrongs = new Set<number>();
  let attempts = 0;
  while (wrongs.size < count && attempts < 50) {
    const w = answer + randomInt(-4, 4);
    if (w !== answer && w >= min && w <= max) wrongs.add(w);
    attempts++;
  }
  while (wrongs.size < count) {
    for (let v = min; v <= max; v++) {
      if (v !== answer && !wrongs.has(v)) { wrongs.add(v); break; }
    }
  }
  return Array.from(wrongs);
}

function additionQuestion(maxA: number, maxSum: number, wrongCount: number): ChallengeQuestion {
  const a = randomInt(1, maxA);
  const b = randomInt(1, Math.min(maxSum - a, maxA));
  const answer = a + b;
  const text = `${a} + ${b} = ?`;
  const wrongs = makeWrongs(answer, wrongCount, 0, maxSum);
  const options = shuffle([answer, ...wrongs]);
  return { text, options: options.map(String), correctIndex: options.indexOf(answer) };
}

function subtractionQuestion(maxVal: number, wrongCount: number): ChallengeQuestion {
  const a = randomInt(2, maxVal);
  const b = randomInt(1, a);
  const answer = a - b;
  const text = `${a} - ${b} = ?`;
  const wrongs = makeWrongs(answer, wrongCount, 0, maxVal);
  const options = shuffle([answer, ...wrongs]);
  return { text, options: options.map(String), correctIndex: options.indexOf(answer) };
}

function sameNumberQuestion(maxVal: number, wrongCount: number): ChallengeQuestion {
  const target = randomInt(1, maxVal);
  const text = `「${target}」と同じ数字を選んでください。`;
  const wrongs = new Set<number>();
  while (wrongs.size < wrongCount) {
    const w = randomInt(1, maxVal);
    if (w !== target) wrongs.add(w);
  }
  const options = shuffle([target, ...Array.from(wrongs)]);
  return { text, options: options.map(String), correctIndex: options.indexOf(target) };
}

export function generateChallenge(difficulty: string): ChallengeQuestion {
  if (difficulty === "easy") {
    const type = randomInt(0, 1);
    if (type === 0) return additionQuestion(5, 9, 2);
    return sameNumberQuestion(9, 2);
  }

  if (difficulty === "hard") {
    const type = randomInt(0, 2);
    if (type === 0) return additionQuestion(30, 60, 3);
    if (type === 1) return subtractionQuestion(30, 3);
    return sameNumberQuestion(50, 3);
  }

  const type = randomInt(0, 2);
  if (type === 0) return additionQuestion(9, 18, 2);
  if (type === 1) return subtractionQuestion(9, 2);
  return sameNumberQuestion(9, 2);
}
