import { formatDate } from './dates';
import { useVault } from '../store/vault';

/** A small starter vault that shows off links, folders and the solar system. */
export function createSampleVault() {
  const today = formatDate(new Date());
  const notes: Record<string, string> = {
    'Welcome.md': `# Welcome to Orrery

Orrery is a notes app where your notes **orbit each other**. Every note is a plain markdown file.

- Read [[Guides]] to learn the basics
- Open the **solar system** (the orbit icon at the top) to fly through your notes
- Jot quick thoughts in [[Inbox]] and bigger ones in [[Ideas]]
- Today's daily note: [[${today}]]

> [!tip] How the solar system works
> Each top-level folder is a galaxy with a **black hole** at its heart (its most linked note).
> Notes linked to it are **stars**, their links are **planets**, and links from those are **moons**.

#start-here`,
    'Inbox.md': `# Inbox

- [ ] Try linking two notes with \`[[\`
- [ ] Add a picture by pasting or dropping it into a note
- [x] Open Orrery for the first time

Related: [[Ideas]]`,
    'Ideas.md': `# Ideas

- A reading tracker that turns books into moons of [[Reading list]]
- Use ==highlights== for the important bits
- Write about [[Astronomy]] every week`,

    'Guides/Guides.md': `# Guides

This folder note is the black hole at the centre of the Guides galaxy, because it has the folder's name.

- [[Linking notes]]
- [[Markdown cheatsheet]]
- [[Solar system]]
- [[Templates and daily notes]]
- [[Sync setup]]
- [[Keyboard shortcuts]]

#guide`,
    'Guides/Linking notes.md': `# Linking notes

Type \`[[\` to link to another note. You'll get suggestions as you type.

- \`[[Note name]]\` links to a note
- \`[[Note name|shown text]]\` shows different text
- \`![[picture.png]]\` embeds a picture, \`![[Another note]]\` embeds a whole note
- Links to notes that don't exist yet appear faded. Click one to create it.

Every note shows its **backlinks** (the notes that link to it) in the right panel.
See also [[Solar system]] and [[Markdown cheatsheet]].

#guide`,
    'Guides/Markdown cheatsheet.md': `# Markdown cheatsheet

**bold**, *italic*, ~~strike~~, ==highlight==, \`code\`

## Lists
- bullet
1. numbered
- [ ] a task you can tick in reading view

## Callouts
> [!note] A note callout
> Use \`> [!note]\`, \`[!tip]\`, \`[!warning]\` and others.

## Code
\`\`\`js
console.log('hello orrery')
\`\`\`

| Planet | Moons |
| ------ | ----- |
| Earth  | 1     |
| Mars   | 2     |

Back to [[Guides]] · #guide`,
    'Guides/Solar system.md': `# Solar system

The solar system shows your whole vault in 3D.

- **Galaxies** are your top-level folders. Notes outside folders live in the *Home* galaxy.
- The **black hole** is the folder note (a note named like its folder) or the most linked note.
- **Stars** are notes linked to the black hole, or the centres of other groups of linked notes.
- **Planets** are notes linked to a star, and **moons** are notes linked to a planet.
- **Asteroids** are notes with no links yet.
- **Light beams** are links between bodies that don't orbit each other.

Every note has an **Orbits** setting (under its title, or on its card in space) to choose exactly what it circles.
Tap a body to see its note, or open its **Design** tab to change its colour, surface, rings and size.
The palette button changes the whole galaxy's theme and lets you style notes by tag or folder.
Related: [[Linking notes]], [[Graph view]]`,
    'Guides/Graph view.md': `# Graph view

A flat, force-directed view of every link. Drag the nodes, pinch or scroll to zoom.
It's the 2D sibling of the [[Solar system]].`,
    'Guides/Templates and daily notes.md': `# Templates and daily notes

- The calendar button opens **today's note** in the \`Daily\` folder.
- Notes in \`Templates\` can be inserted from the command palette (Ctrl/⌘ + P → *Insert template*).
- Templates can use \`{{date}}\`, \`{{time}}\`, \`{{title}}\`, \`{{yesterday}}\` and \`{{tomorrow}}\`.

See [[Daily note]] for the daily template.`,
    'Guides/Sync setup.md': `# Sync setup

Orrery syncs through a small server you run yourself, on your Linux machine or a VPS.

1. Run \`bun run start\` in the project folder
2. Copy the token it prints
3. In Orrery, open **Settings** and enter the server address and the token

The server keeps your vault as plain \`.md\` files in a folder, so you can edit them with any editor.
Back to [[Guides]]`,
    'Guides/Keyboard shortcuts.md': `# Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | Ctrl/⌘ P |
| Quick switcher | Ctrl/⌘ O |
| New note | Ctrl/⌘ Alt N |
| Toggle edit/preview | Ctrl/⌘ E |
| Today's note | Ctrl/⌘ Shift D |
| Solar system | Ctrl/⌘ Shift S |
| Graph view | Ctrl/⌘ G |
| Bold / italic | Ctrl/⌘ B / I |

Back to [[Guides]]`,

    'Projects/Projects.md': `# Projects

- [[Orrery roadmap]]
- [[Website redesign]]
- [[Reading list]]

#project`,
    'Projects/Orrery roadmap.md': `# Orrery roadmap

- [x] Notes, links and backlinks
- [x] Solar system view
- [x] Self-hosted sync
- [ ] Plugins
- [ ] Canvas boards

Inspired by [[Kepler's laws]].
#project`,
    'Projects/Website redesign.md': `# Website redesign

- [[Color palette]]
- [[Typography]]
- [ ] Ship by Friday

#project #design`,
    'Projects/Color palette.md': `# Color palette

Deep space navy, sun gold and nebula violet. Part of [[Website redesign]]. #design`,
    'Projects/Typography.md': `# Typography

Headings in a geometric sans, body in a humanist sans. Part of [[Website redesign]]. #design`,
    'Projects/Reading list.md': `# Reading list

- [ ] *Cosmos*, Carl Sagan
- [ ] *The Three-Body Problem*, Liu Cixin
- [x] *Pale Blue Dot*

See [[Astronomy]].
#reading`,

    'Learning/Learning.md': `# Learning

- [[Astronomy]]
- [[Rust basics]]
- [[Spaced repetition]]`,
    'Learning/Astronomy.md': `# Astronomy

- [[Planets]]
- [[Moons]]
- [[Kepler's laws]]

#science`,
    'Learning/Planets.md': `# Planets

Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune.
Many of them have [[Moons]]. #science`,
    'Learning/Moons.md': `# Moons

Jupiter has more than 90 known moons. Back to [[Planets]]. #science`,
    "Learning/Kepler's laws.md": `# Kepler's laws

1. Orbits are ellipses with the sun at one focus.
2. A planet sweeps out equal areas in equal times.
3. The orbital period squared is proportional to the semi-major axis cubed.

Orrery's orbits follow law 3: outer planets move slower. #science`,
    'Learning/Rust basics.md': `# Rust basics

\`\`\`rust
fn main() {
    println!("Hello, orbit!");
}
\`\`\`
Tauri, which runs Orrery's desktop app, is written in Rust.`,
    'Learning/Spaced repetition.md': `# Spaced repetition

Review notes at growing intervals: 1 day, 3 days, 1 week, 1 month.`,

    'Templates/Daily note.md': `# {{date}}

← [[{{yesterday}}]] · [[{{tomorrow}}]] →

## Plan
- [ ]

## Notes
`,
    'Templates/Meeting.md': `# Meeting: {{title}}

**Date:** {{date}} {{time}}
**People:**

## Agenda
-

## Actions
- [ ]
`,
    [`Daily/${today}.md`]: `# ${today}

## Plan
- [ ] Explore the [[Solar system]]
- [ ] Write a first note

## Notes
Started using Orrery today. [[Welcome]]`,
  };

  const { createNote, open } = useVault.getState();
  for (const [path, content] of Object.entries(notes)) createNote(path, content, false);
  open('Welcome.md');
}
