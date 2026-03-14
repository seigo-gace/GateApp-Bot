export interface ChallengeQuestion {
  text: string;
  options: string[];
  correctIndex: number; // 0-based
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

export function generateChallenge(difficulty: string): ChallengeQuestion {
  const type = randomInt(0, 2);

  if (type === 0) {
    // Arithmetic
    let a: number, b: number, answer: number, op: string;
    if (difficulty === "easy") {
      a = randomInt(1, 10);
      b = randomInt(1, 10);
      op = "+";
      answer = a + b;
    } else if (difficulty === "hard") {
      a = randomInt(10, 30);
      b = randomInt(2, 10);
      op = randomInt(0, 1) === 0 ? "+" : "×";
      answer = op === "+" ? a + b : a * b;
    } else {
      a = randomInt(5, 20);
      b = randomInt(1, 10);
      op = randomInt(0, 1) === 0 ? "+" : "-";
      answer = op === "+" ? a + b : a - b;
    }
    const text = `${a} ${op} ${b} = ?`;
    const wrongs = new Set<number>();
    while (wrongs.size < 3) {
      const w = answer + randomInt(-5, 5);
      if (w !== answer) wrongs.add(w);
    }
    const options = shuffle([answer, ...Array.from(wrongs).slice(0, 2)]);
    return { text, options: options.map(String), correctIndex: options.indexOf(answer) };
  } else if (type === 1) {
    // Sequence: find next number
    const start = randomInt(1, 10);
    const step = randomInt(2, 5);
    const seq = [start, start + step, start + 2 * step];
    const answer = start + 3 * step;
    const text = `${seq.join(", ")}, ?`;
    const wrongs = [answer + step, answer - step, answer + 1];
    const options = shuffle([answer, ...wrongs.slice(0, 2)]);
    return { text, options: options.map(String), correctIndex: options.indexOf(answer) };
  } else {
    // Direction / instruction understanding
    const challenges = [
      {
        text: "「はい」と書かれたボタンを押してください。",
        options: ["はい", "いいえ", "どちらでも"],
        correct: "はい",
      },
      {
        text: "一番左のボタンを押してください。",
        options: ["左", "中央", "右"],
        correct: "左",
      },
      {
        text: "「進む」を選んでください。",
        options: ["止まる", "進む", "戻る"],
        correct: "進む",
      },
    ];
    const c = challenges[randomInt(0, challenges.length - 1)]!;
    const options = shuffle([...c.options]);
    return {
      text: c.text,
      options,
      correctIndex: options.indexOf(c.correct),
    };
  }
}
