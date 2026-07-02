# Layout thrashing, or how reading a number can freeze your page

Here is a number that should not be possible.

Two loops. Same work. The same 2,000 elements.

One takes **4.9 milliseconds**.

The other takes **2,504 milliseconds**.

That is 511 times slower. For the same result.

The slow one didn't do more work. It did the same work in the wrong *order*. It read a value at the wrong moment.

That is layout thrashing.

By the end of this you'll be able to look at a loop and say, out loud, exactly when the browser is about to freeze — and why.

## The one question underneath

You write this:

```js
const height = box.offsetHeight;
```

You just read a number. A property. It looks free.

It is not free.

In the wrong loop, that one line is slower than a network call.

So here is the question this whole post answers:

    How can *reading* a value off an element
    be the slowest thing your page does?

To answer it, you have to know what the browser is doing behind that read. So let's follow a frame.

## The pipeline — what happens between your code and a pixel

Your JavaScript does not draw pixels.

It changes a description of the page. The browser turns that description into pixels, in stages, in order:

    Your JavaScript
    ↓
    Style      (which CSS rules apply to which elements?)
    ↓
    Layout     (where is every box, and how big?)
    ↓
    Paint      (what color is every pixel — as a list of draw commands)
    ↓
    Composite  (stitch the painted layers together on the GPU)

Four stages after your code runs. Each one takes the output of the last.

Now the part most explanations skip. **Where does each stage run?**

    Your JavaScript    → main thread
    Style              → main thread
    Layout             → main thread
    Paint (record)     → main thread
    Raster + Composite → compositor thread + GPU

The first four share one thread. The same thread that runs your code. The same thread that handles clicks and keystrokes.

If that thread is busy, nothing else happens. No frame. No response to input. The page is frozen.

Hold onto that line. It is the whole story.

## What "Layout" actually computes

Style decides *which* rules apply.

Layout decides *where everything goes*.

Given the tree of boxes and their styles, Layout computes the geometry: for every element, its x, y, width, and height. Where it sits. How big it is.

The data going in: a tree of boxes plus their styles.

The data coming out: the same tree, now with a number for every position and size.

This is expensive, and it is not local. Boxes affect each other. Make one wider and its siblings shift. Its parent grows. On a page with a thousand boxes, Layout has to place a thousand boxes, together.

So the browser does something clever to avoid running it too often.

## The browser is lazy on purpose

The browser does not recompute Layout every time you touch the DOM.

That would be madness. You might change ten things in one function.

So when you write something that could change geometry:

```js
box.style.width = "200px";
```

the browser does *not* recompute layout.

It makes a note: *layout is dirty now.*

Then it goes back to running your code.

It is waiting. It wants to batch. The plan is to recompute layout **once**, later — right before it paints the next frame, after your code is done making its mess.

    write, write, write   → "dirty, dirty, dirty"   (no layout yet)
    ...your code finishes...
    ↓
    Layout runs once
    ↓
    Paint

One layout per frame, no matter how many writes. That is the plan.

The up-to-date geometry is *clean*, and the browser keeps it cached. A write marks it *dirty*. Clean layout is stored and reused. Dirty layout is a promise to recompute — later.

Later. Not now.

That word is doing all the work.

## The trap: when "later" becomes "right now"

Here is the naive loop. It looks completely reasonable.

You have a list of boxes. You want to double each one's height.

```js
for (const box of boxes) {
  const height = box.offsetHeight;       // READ
  box.style.height = height * 2 + "px";  // WRITE
}
```

Read the height. Write double. Next box.

You might think reading `offsetHeight` is cheap. It's just a property.

But watch what it does to the browser's plan.

The browser wanted to batch layout for later. Then you ask for `offsetHeight`.

`offsetHeight` is a geometry value. To hand you a truthful answer, the browser needs layout to be clean. But you dirtied it one line ago, when you wrote `style.height` on the previous box.

So the browser has no choice. It will not give you a stale number. It stops, and recomputes layout **right now** — synchronously, in the middle of your loop — just to answer your read.

That is a forced synchronous layout. A forced reflow.

Then the next line writes `style.height` again. Dirty again.

Next iteration reads `offsetHeight`. Forced reflow again.

    write → read → reflow → write → read → reflow → ...

For a thousand boxes, that is a thousand full layouts, in a single frame. The browser is running the most expensive stage of its pipeline over and over — because you keep asking it a question it can only answer by doing the work.

That is the thrash.

## The fix is just reordering

You don't need to do less work. You need to stop interleaving.

Do all the reads first. Then all the writes.

```js
// read everything while layout is still clean
const heights = boxes.map((box) => box.offsetHeight);

// now write everything — this dirties layout, but nobody reads it back
boxes.forEach((box, i) => {
  box.style.height = heights[i] * 2 + "px";
});
```

The reads happen while layout is clean, so they're free — the browser hands back cached numbers.

Then the writes happen together. They dirty layout. But nothing reads it back before the loop ends. So the browser keeps its promise: it recomputes layout **once**, afterward, before the next paint.

A thousand forced reflows became one.

Same boxes. Same result. These are the two numbers from the top:

    thrash  (read, write, read, write):   2,504 ms
    batched (read all, then write all):       4.9 ms

511 times faster. By moving the reads above the writes.

## So, the definition

Layout thrashing is reading a layout value after you've written one, in a loop, forcing the browser to recompute layout every time.

That is all it is.

It is not a browser bug. The browser is doing exactly what you asked: handing you a truthful, up-to-date number. Every single time you ask.

## When a read after a write is fine

Now don't over-correct.

You could read all this and start fearing every `offsetHeight`.

Here is the auto-growing textarea you have probably written:

```ts
const handleInput = (e) => {
  const el = textareaRef.current;
  if (!el) return;
  el.style.height = "auto";                  // WRITE — reset so it can shrink
  el.style.height = el.scrollHeight + "px";  // READ (one flush) + WRITE
};
```

There is a write, then a read, then a write. By the letter of the definition, that read forces a reflow.

And it is completely fine.

It forces layout once. On one element. When the user types a character.

Thrashing is not "a read after a write." It is a read after a write *repeated* — in a loop, across many elements, many times per frame. One flush on one textarea is a rounding error. A thousand flushes in one loop is a frozen page.

The scale is the whole difference.

If you want it tidy, do the read-once move anyway. It costs nothing and it reads better:

```ts
el.style.height = "auto";       // write
const next = el.scrollHeight;   // read once
el.style.height = next + "px";  // write
```

The rule that actually matters: don't go on to read *more* layout — `offsetHeight`, `getBoundingClientRect()` — later in the same handler, especially in a loop. One localized read-write pair is not the enemy. Interleaving is.

## The reads that spring the trap

The dangerous read isn't only `offsetHeight`.

It's any value that depends on layout. Ask for one while layout is dirty, and you force a reflow.

There's a canonical list (Paul Irish maintains it). The ones you actually hit:

- `offsetTop`, `offsetLeft`, `offsetWidth`, `offsetHeight`
- `clientTop`, `clientWidth`, `clientHeight`
- `scrollTop`, `scrollWidth`, `scrollHeight`
- `getBoundingClientRect()`
- `window.innerWidth`, `window.innerHeight` — yes, even these
- `getComputedStyle(el)` — when you read a layout-dependent value off it

That last one is the sneaky one.

`getComputedStyle` looks like it just reads CSS. Passive. Harmless. But ask it for `.height` while layout is dirty, and it forces the exact same reflow `offsetHeight` does.

People sprinkle `getComputedStyle` through render loops thinking it's a free lookup.

It is not free.

It is not a passive CSS read.

It forces layout, same as `offsetHeight` — just wearing a different coat.

## The expensive part is the call, not the value

Here is the part that saves you.

`getBoundingClientRect()` forces layout when you *call* it. Once, and only if layout was dirty.

What it hands back is a `DOMRect` — a plain object, frozen at that moment:

```ts
const rect = container.getBoundingClientRect(); // may force layout — once
```

That `rect` is a snapshot. It is detached from the live page. Reading from it later is just reading an object in memory:

```ts
rect.height; // free — no layout
rect.top;    // free
rect.width;  // free
```

You might think every `rect.height` re-measures the element.

It does not.

The measuring already happened, at the call. The object does not update itself when the page changes underneath it.

So the pattern that avoids thrashing is not "never read geometry." It is:

    Call once. Store the rect. Read from the snapshot.

One `getBoundingClientRect()` at the top of your frame, cached in a variable, can feed a hundred later reads for free. The trap is calling it a hundred times — once per element, interleaved with writes.

## Where thrashing loves to hide: scroll handlers

The loop doesn't have to be a `for` loop you wrote.

The worst one fires on scroll.

```js
scroller.addEventListener("scroll", () => {
  for (const box of boxes) {
    const rect = box.getBoundingClientRect(); // forced reflow, ×N
    // ...work out whether this box is on screen
  }
});
```

Scroll events fire fast — many times a second, in the gaps between frames. Each one reads `getBoundingClientRect()` for every box. Each read forces layout.

So the user drags, and every scroll tick is doing hundreds of reflows. The scroll stutters. The thing they're touching is the thing that's frozen.

The fix is the same shape: read once and cache, or throttle to one read per frame.

But this handler at least contains its own crime — the reads and the loop are right there to review. The worst version of this bug doesn't.

## The write you can't see: thrashing across frames

Here is a real one, from a production docs site.

The table of contents highlights the heading you're currently reading. A scroll handler finds it:

```tsx
const handleScroll = () => {
  for (const heading of headings) {
    const rect = heading.getBoundingClientRect(); // READ — clean, right?
    // ...find the heading nearest the top of the viewport
  }
  setActiveHeadingId(nearest); // React state update. Not a DOM write... yet.
};
```

Now look for the write→read interleave.

It is not there.

All the reads happen first. Then one `setState`. Inside this function, the ordering is textbook-correct.

But `setState` is a *deferred* write. React re-renders and commits the new highlight class to the DOM after the handler returns — in the gap between this scroll event and the next one.

So the timeline across events looks like this:

    scroll event 1:  reads (layout clean — cheap) → setState
    ↓
    React commits the highlight class   → layout is dirty now
    ↓
    scroll event 2:  first read         → FORCED REFLOW
    ↓
    React commits the next highlight    → dirty again
    ↓
    scroll event 3:  first read         → forced reflow again…

No single function contains the anti-pattern. The write and the read live in different frames. The interleaving only exists across time — which is exactly why it survives code review. Every piece, reviewed alone, is correct.

Measured on that TOC, with a heading list about twenty items long: **25 layout reads per frame** while scrolling, and **60% of frames** doing forced-layout work.

The fix didn't reorder the reads. It deleted them.

`IntersectionObserver` lets you describe the zone you care about once — and then the *browser* tells you when things cross it:

```ts
const observer = new IntersectionObserver(onHeadingsCrossed, {
  rootMargin: "0px 0px -66% 0px", // only the top third counts as "being read"
});
headings.forEach((heading) => observer.observe(heading));
```

The observer computes intersections off the hot path and calls back with ready-made entries — each one already carrying a `boundingClientRect`, precomputed, free. The handler flips a class and never asks the DOM a geometry question.

Same TOC, after the refactor: **3.6 reads per frame. 6% thrashing frames instead of 60%.** Same highlight, same UX.

And notice what the fix did *not* do: it did not stop writing. The highlight still moves, the class flip still dirties layout, and the browser still reflows once before the next paint — exactly as designed.

Writes are unavoidable. The page has to change; that is the point of the page.

What you can avoid is asking geometry questions while the answer is being recomputed. Stop the asking, and the writes go back to being what the browser always wanted them to be: batched, once, right before paint.

## The real fix, generalized: reads now, writes later

The loop fix was "all the reads, then all the writes."

The same idea scales up to your whole app. The tool for it is `requestAnimationFrame`.

`requestAnimationFrame` runs your callback once, right before the browser paints the next frame — after the current JavaScript has finished.

So you can split a frame into two phases:

    during the event:    read everything you need — layout is clean
    ↓
    requestAnimationFrame
    ↓
    just before paint:   write everything — layout dirties, then flushes once

Reads now. Writes later. Never interleaved.

Here it is on a scroll-to-top after some change:

```ts
// before — a synchronous write, in the middle of everything else
container.scrollTo({ top: 0 });

// after — deferred to just before the next paint
requestAnimationFrame(() => {
  container.scrollTo({ top: 0 });
});
```

Wrapping the write in `requestAnimationFrame` lifts it out of the read phase. If you had already read some geometry earlier in the same event, this stops the write from forcing a reflow in the middle of it.

This is the seed of what a library like FastDOM does: a `measure()` queue and a `mutate()` queue, both flushed in one rAF, reads always before writes.

But be honest about what you changed.

The write now happens one frame later.

You might think that is free.

It is not always.

```ts
requestAnimationFrame(() => {
  container.scrollTo({ top: 0 });
});
const top = container.scrollTop; // reads the OLD position — the scroll hasn't run yet
```

Any code right after — anything that assumes the scroll already happened — now sees the old value. If something depends on "we are at the top now," either keep the write synchronous, or move that dependent code into the same `requestAnimationFrame` callback.

Deferring a write buys you clean read/write ordering. It costs you a frame of "not yet." Know which one you need.

## The sibling problem: animating the wrong property

Layout thrashing is *reads* forcing layout. There's a mirror problem: *writes* that force layout every frame.

Animate an element's position with `left` and `top`:

```js
box.style.left = x + "px"; // layout property
box.style.top = y + "px";
```

`left` and `top` are layout properties. Change them and the browser re-runs Layout — then Paint, then Composite — every frame of the animation. On many elements, it starts missing frames.

Animate with `transform` instead:

```js
box.style.transform = `translate(${x}px, ${y}px)`;
```

`transform` touches neither Layout nor Paint. It goes straight to Composite — the GPU stage, off the main thread. The browser just moves a layer it already painted. Cheap.

Two properties. The same motion on screen. One re-runs the whole pipeline; the other skips to the last stage.

This is also why `transition: all` is a quiet trap. It opts *every* animatable property into transitions — including the layout ones. You meant to fade a color. You also signed up to animate `margin`, and now the browser runs Layout through the entire transition.

Name the properties you actually animate. Never `all`.

## The twist: a smooth FPS counter can be lying

Here is where the mental model earns its keep.

I built a small lab for all of this — a grid of boxes, a checkbox per anti-pattern, and a live FPS meter. Tick "forced reflow loop" and the meter craters from 120 to 4. You can watch the frame time explode from 8 ms to 235 ms. The thrash is right there in the number.

Then I added a "paint bomb": heavy blurred shadows, re-painted every frame, across a thousand boxes. Genuinely expensive.

I ticked it, expecting the meter to crater again.

It didn't move. 120 FPS. 8.3 ms. Flat.

The animation was visibly stuttering — and the number said everything was fine.

Go back to the pipeline. Where does Paint run? The main thread *records* the paint, but the heavy part — rasterizing all that blur — happens on the compositor thread and the GPU. My FPS meter measures the main thread, by timing `requestAnimationFrame`. It is blind to compositor work by construction.

You might think a green FPS counter means a fast page.

It means a free *main thread*. That is not the same thing.

Layout thrashing shows up there, because Layout is on the main thread. Paint jank doesn't, because raster isn't. To see paint cost you need a different instrument — DevTools' rendering stats — not a rAF counter.

The blind spot is the lesson. Always know which thread your metric is watching.

## When this isn't your problem

Reordering reads and writes is the fix for thrashing. But be honest about the ceiling.

If you're thrashing over ten thousand DOM nodes, the real problem isn't the ordering — it's that you have ten thousand nodes. The fix is to render fewer of them (virtualization), not to reflow all of them more politely.

And not every janky page is thrashing. If your reads and writes are already batched and it still stutters, you might be paint-bound, or running too much JavaScript, or animating the wrong property. Layout thrashing is one specific cause with one specific fix. Reach for it when you see reads and writes interleaved — not as a cure-all.

## The whole thing, in three lines

The browser batches layout, so it computes geometry once per frame.

A read after a write forces it to compute *now*, in the middle of your loop.

Move every read above every write, and a thousand reflows collapse into one.
