# GCX-GCD Exam Simulator

A practice exam for the **Genesys Cloud CX: Developer (GCX-GCD)** certification. It runs entirely in the browser with no build step and no server.

## Run it

- **Locally:** open `index.html` in Chrome or Firefox.
- **GitHub Pages:** Settings → Pages → Deploy from branch → `main` / root. The site will be at `https://jcliff01.github.io/gcd-prep/`.

## Features

- Pick the number of questions (10, 25, 40 or all 80), a time limit, a pass mark, and which topics to include.
- Questions are drawn evenly across topics, and the answer options are shuffled.
- **Show answer** reveals the correct option(s) and an explanation. Questions you got help on are tracked, and your results show your score both with and without help.
- **Flag** questions to come back to, and use the question grid to jump around.
- Results show pass/fail, your score by topic, which topics to focus on, and a full review you can filter (incorrect, answer shown, flagged).
- **Retake incorrect questions** starts a new exam from just the ones you missed.
- Progress is saved in the browser, so you can close the tab and resume later. Recent attempts are kept on the start screen.
- Keyboard: ← / → to move between questions, 1–9 to pick an option.

## Topics

| Topic | Questions |
| --- | --- |
| Platform & API | 14 |
| OAuth & Security | 8 |
| Conversations API | 14 |
| Analytics API | 8 |
| Notifications API | 7 |
| Telephony | 10 |
| Contact Center | 19 |

## Adding questions

Questions live in `questions.js`. Each one looks like this:

```js
{
  id: "a9",                       // unique
  topic: "Analytics API",         // must match an entry in window.TOPICS
  q: "Question text",
  code: "optional code block",    // optional
  options: ["A", "B", "C", "D"],
  answer: [1],                    // indexes of the correct options; 2+ indexes = "choose N"
  explain: "Why the answer is right.",
}
```

## Notes

- The questions are written from a study guide checked against the Genesys Developer Center. They are practice material, not real exam questions.
- The default pass mark of 70% is a practice target. Check the official pass mark with Genesys.
