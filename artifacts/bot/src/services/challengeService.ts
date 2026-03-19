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

export function generateChallenge(_difficulty: string): ChallengeQuestion {
  const type = randomInt(0, 2);

  if (type === 0) {
    const a = randomInt(1, 5);
    const b = randomInt(1, 9 - a);
    const answer = a + b;
    const text = `${a} + ${b} = ?`;
    const wrongs = new Set<number>();
    while (wrongs.size < 2) {
      const w = answer + randomInt(-3, 3);
      if (w !== answer && w >= 0 && w <= 9) wrongs.add(w);
    }
    const options = shuffle([answer, ...Array.from(wrongs)]);
    return { text, options: options.map(String), correctIndex: options.indexOf(answer) };
  }

  if (type === 1) {
    const answer = randomInt(0, 6);
    const a = answer + randomInt(1, 3);
    const b = a - answer;
    const text = `${a} - ${b} = ?`;
    const wrongs = new Set<number>();
    while (wrongs.size < 2) {
      const w = answer + randomInt(-3, 3);
      if (w !== answer && w >= 0 && w <= 9) wrongs.add(w);
    }
    const options = shuffle([answer, ...Array.from(wrongs)]);
    return { text, options: options.map(String), correctIndex: options.indexOf(answer) };
  }

  const target = randomInt(1, 9);
  const text = `「${target}」と同じ数字を選んでください。`;
  const wrongs = new Set<number>();
  while (wrongs.size < 2) {
    const w = randomInt(1, 9);
    if (w !== target) wrongs.add(w);
  }
  const options = shuffle([target, ...Array.from(wrongs)]);
  return { text, options: options.map(String), correctIndex: options.indexOf(target) };
}
