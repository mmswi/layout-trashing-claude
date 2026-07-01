@AGENTS.md

## Coding standards

This project follows Mihai's coding standards. When writing, reviewing, or
refactoring any TypeScript here — components, hooks, props types, `lib/` code,
and above all naming — **use the `mihai-coding-standards` skill and apply it.**
Invoke it before writing code, not after.

### Deliberate anti-patterns (do not "fix")

This app exists to demonstrate the exact patterns those standards forbid:
`transition: all`, interleaved DOM read→write (forced reflow), and animating
layout properties instead of `transform`. Those live **only** inside
`lib/techniques.ts` as the subject of the demo, each clearly labeled. Every
other file follows the standards normally. A code-review pass should leave the
technique registry's anti-patterns intact.
