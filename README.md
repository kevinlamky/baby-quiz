# 愛伴成長 ・ 育嬰知識大挑戰 (baby-quiz)

## Purpose

A quiz game for the kindergarten's public event 「愛伴成長 — 嬰兒成長禮 2026」. Participants play
one at a time: a roulette picks 3 random questions out of a 3×3 grid of 9 baby-care questions,
each with four options. After every answer the correct option and an explanation are shown.
3 correct = gold medal, 2 = silver, 1 = bronze, 0 = an encouragement screen.

It is a plain static web page (HTML + CSS + JavaScript, no install, no internet needed), so it
runs on any computer with a modern browser. The whole game is drawn on a fixed 16:9 stage that
scales to the screen, so it looks the same on a laptop, TV or projector.

## Setup

Nothing to install.

1. Copy the whole `baby-quiz` folder to the event computer (USB / AirDrop / zip).
2. Double-click `index.html` (Chrome, Edge or Safari).
3. Press `F` (or the ⛶ button, top right) for full screen.

## How to play (operator guide)

| Step | Button | Keyboard |
| --- | --- | --- |
| Start | 開始挑戰 | `Enter` / `Space` |
| Draw a question | 🎲 抽題目 | `Enter` / `Space` |
| Answer | click an option | `1`–`4` or `A`–`D` |
| Next question / see result | 下一題 / 看成績 | `Enter` / `Space` |
| Next participant | 下一位參加者 | `Enter` / `Space` |

Top-right buttons: 🔊 sound on/off, ⛶ full screen, ↺ 重新開始 (reset mid-game, asks to confirm).

## Editing the questions

All 9 questions live in `js/questions.js`. Edit the text, save, and refresh the page.
`answer` is the position of the correct option: `0` = A, `1` = B, `2` = C, `3` = D.
Keep exactly 9 questions (one per grid tile) and 4 options each.

Question 1 was supplied by the organiser; questions 2–9 were drafted from WHO / Hong Kong
Department of Health guidance and **should be reviewed by the organiser before the event**.

## Files

- `index.html` — page structure (start, grid, question, award screens)
- `css/style.css` — all styling and animations
- `js/questions.js` — the question bank
- `js/app.js` — game logic, roulette, synthesised sound effects, confetti
- `assets/backdrop-v5.webp` — event backdrop artwork
