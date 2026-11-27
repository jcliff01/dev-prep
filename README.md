# dev-prep

A practice test for a developer certification exam. It runs entirely in the browser with no build step and no server.

## Run it

- **Locally:** open `index.html` in Chrome or Firefox.
- **GitHub Pages:** Settings → Pages → Deploy from branch → `main` / root.

## Features

- Pick the number of questions (10, 25, 40 or all 80), a time limit, a pass mark, and which topics to include.
- Questions are drawn evenly across topics, and the answer options are shuffled.
- **Show answer** reveals the correct option(s) and an explanation. Questions you got help on are tracked, and your results show your score both with and without help.
- **Flag** questions to come back to, and use the question grid to jump around.
- Results show pass/fail, your score against the pass mark, your score by topic, which topics to focus on, and a full review you can filter (incorrect, answer shown, flagged).
- **Retake incorrect questions** starts a new exam from just the ones you missed.
- Progress is saved in the browser. **Save and exit** leaves an exam part-way and you can resume it later (a time limit keeps counting).
- Keyboard: ← / → to move between questions, 1–9 to pick an option, F to flag.
- Follows your system's light or dark theme.

## History

The **History** page keeps your last 50 attempts in the browser:

- Exams taken, average score, best score and how many you passed.
- A score trend across your full exams, and your accuracy by topic added up over all of them.
- **Questions you miss most**, with a button to practise just those.
- **Review** reopens any attempt with every question, your answer and the explanation. **Delete** removes one attempt.
- **Export** downloads your history as a JSON file and **Import** merges one back in, so you can move it between browsers (a local `index.html` and the GitHub Pages site keep separate history).

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

- The questions are practice material written from a study guide, not real exam questions.
- The default pass mark of 70% is a practice target. Check the official pass mark for your exam.
