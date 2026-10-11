# DrivePlayer

A friendly, dependency-free video player for **public Google Drive videos**.
Drop one script on any page and show a Drive video:

- **inline**: inside a blog post, guide, docs page or dashboard card
- **floating**: a tutorial widget pinned to a dashboard corner that users can drag, minimize, enlarge and close
- **modal**: a lightbox that opens from any button or link

```html
<script src="drive-player.js"></script>

<drive-player src="https://drive.google.com/file/d/FILE_ID/view" title="Product tour"></drive-player>
```

Open `index.html` for a visual **embed builder**: paste a Drive link, pick a style and copy the code.
Try it with a real Drive video: `demo.html` (add `?src=YOUR_DRIVE_LINK` for another one).
Live demos: `examples/dashboard.html`, `examples/blog.html` and `examples/guide.html`. Add
`?src=YOUR_DRIVE_LINK` to any demo URL to try your own video.

---

## 1. Make the Drive video public

1. In Google Drive, right-click the video and choose **Share**.
2. Under **General access**, choose **Anyone with the link** (Viewer).
3. Click **Copy link**. Any of these formats work, as does the bare file ID:
   - `https://drive.google.com/file/d/FILE_ID/view?usp=sharing`
   - `https://drive.google.com/open?id=FILE_ID`
   - `https://drive.google.com/uc?id=FILE_ID`

## 2. How playback works (and why it never shows a dead player)

Google Drive doesn't offer an official "stream this file" URL, so DrivePlayer tries these sources in order:

| Step | Source | Notes |
|------|--------|-------|
| 1 | Drive API `files/ID?alt=media&key=…` | Only if you set `api-key`. **Most reliable**, works for large files, supports seeking. |
| 2 | `drive.usercontent.google.com/download?…` | Works for many public files without a key. |
| 3 | `drive.google.com/uc?export=download…` | Older direct link. |
| 4 | Google Drive's own embedded player (`/preview`) | Automatic fallback. Always works for public files, but shows Drive's controls instead of DrivePlayer's. |

Steps 1–3 play in DrivePlayer's own player with all the controls below. If Google refuses to stream
the file directly (common for very large files without an API key), the player switches to step 4
automatically and fires a `dp:fallback` event. The floating, modal and closable modes keep working in
every case.

**Recommended for production:** create a free API key in Google Cloud Console, enable the
*Google Drive API*, restrict the key to your website's domain (HTTP referrers) and the Drive API,
then add `api-key="YOUR_KEY"`.

## 3. Controls

**Basic:** big play button, play/pause, seek bar with buffered range and hover time preview, current and total time, volume slider, mute, full screen.

**Advanced:**
- Playback speed from 0.25× to 2× (menu, or <kbd>Shift</kbd>+<kbd>&gt;</kbd> / <kbd>&lt;</kbd>)
- Skip back and forward 10s (buttons, <kbd>J</kbd>/<kbd>L</kbd>, arrow keys for 5s)
- **Chapters**: markers on the seek bar, chapter name in the bar and seek tooltip, and a chapter menu (<kbd>,</kbd> / <kbd>.</kbd> jump between chapters)
- Loop, fill/fit (crop) toggle, picture-in-picture
- **Resume**: remembers where each viewer stopped, and their volume
- Keyboard shortcuts overlay (press <kbd>?</kbd>), <kbd>0</kbd>–<kbd>9</kbd> to jump to 0–90%
- Touch: tap to show controls, double-tap left or right to skip 10s, double-tap the middle for full screen
- Switch to the Google Drive player or open in Drive from the settings menu
- Controls auto-hide while playing, and the layout adapts to narrow widths

## 4. Display modes

### Inline (default)

```html
<drive-player src="DRIVE_LINK" title="How it works"
  chapters="0:00 Intro; 1:20 Setup; 3:05 Tips"></drive-player>
```

It fills the width of its container at 16:9. Wrap it in a sized element to control its width.

### Closable tutorial card (inline, inside a dashboard grid)

```html
<drive-player src="DRIVE_LINK" title="How to read this report"
  closable dismiss-key="report-help-v1"></drive-player>
```

It shows a title bar with an ✕. Once a viewer closes it, it stays hidden for them, because the `dismiss-key` is remembered in their browser.

### Floating corner widget (dashboard tutorial)

```html
<drive-player
  id="tour"
  mode="floating"
  position="bottom-right"
  src="DRIVE_LINK"
  title="Welcome! Quick tour"
  launcher="Watch the tour"
  dismiss-key="dashboard-tour-v1"></drive-player>

<!-- optional: any element can reopen it -->
<button data-drive-player-open="tour">Help</button>
```

- **Drag** the title bar anywhere. It snaps to the nearest corner, which is remembered.
- **Minimize** (_) collapses it to the title bar, and the video keeps playing. Add `pause-on-minimize` to pause instead.
- **Enlarge** (⤢) switches between the normal and large sizes.
- **Close** (✕) pauses it and leaves a small "Watch the tour" button in the corner. With `dismiss-key` it stays closed on later visits until the viewer reopens it.
- `launcher="none"` hides the reopen button completely after closing.
- `start-minimized` starts it collapsed.
- Change the dismiss key (`-v2`) when you publish a new tutorial so everyone sees it again.

### Lightbox (modal)

The easiest way needs no player tag at all. Any element with `data-drive-src` opens a shared lightbox:

```html
<button data-drive-src="DRIVE_LINK" data-title="Step 2 · Invite your team" data-start="1:30">▶ Watch</button>
```

Or declare one and open it by id:

```html
<drive-player id="intro" mode="modal" src="DRIVE_LINK" title="Intro"></drive-player>
<button data-drive-player-open="intro">Watch intro</button>
```

Close with ✕, <kbd>Esc</kbd>, or a click on the backdrop.

## 5. All attributes

| Attribute | Example | Description |
|---|---|---|
| `src` | Drive link or file ID | Required. Any other video URL (e.g. `.mp4`) also works. |
| `title` | `"Product tour"` | Shown in the title bar, the inline overlay and the launcher. |
| `mode` | `inline` · `floating` · `modal` | Display mode. |
| `chapters` | `"0:00 Intro; 1:30 Setup"` | Chapters separated by `;` or new lines. |
| `start` | `"90"` or `"1:30"` | Start time. |
| `autoplay` + `muted` | | Browsers only autoplay muted videos. |
| `loop` | | Loop playback. |
| `remember` | `"false"` | Turn off resume-where-you-left-off. |
| `poster` | image URL or `none` | Defaults to the Drive thumbnail. |
| `api-key` | `"AIza…"` | Google API key for reliable direct streaming. |
| `engine` | `drive` | Always use Google Drive's own player. |
| `no-fallback` | | Show an error instead of switching to the Drive player. |
| `preload` | | Load the video's metadata before the viewer presses play. |
| `closable` | | Inline mode: show a title bar with a close button. |
| `dismiss-key` | `"tour-v1"` | Remember "closed" (and the floating corner) per viewer. |
| `position` | `bottom-right` · `bottom-left` · `top-right` · `top-left` | Floating corner. |
| `launcher` | `"Watch tutorial"` · `none` | Text of the reopen button after closing a floating player. |
| `start-minimized`, `pause-on-minimize` | | Floating behaviour. |
| `no-pip` | | Hide the picture-in-picture button. |

### Styling

```css
drive-player {
  --dp-accent: #e8590c;   /* buttons, progress, highlights */
  --dp-radius: 10px;      /* corner rounding */
  --dp-width: 420px;      /* floating widget width */
  --dp-gap: 24px;         /* floating distance from the screen edge */
}
```

## 6. JavaScript API

```js
const p = document.querySelector('drive-player');
p.play(); p.pause(); p.toggle(); p.seek(75);
p.open(); p.close(); p.minimize(); p.toggleSize();
p.toggleFullscreen(); p.togglePip(); p.useDrivePlayer();
p.video;     // the underlying <video> element
p.driveId;   // parsed Drive file ID

DrivePlayer.open({ src, title, chapters, start });   // open the shared lightbox
DrivePlayer.create({ src, mode: 'floating', title: 'Tour', dismissKey: 'tour-v1' });
DrivePlayer.parseId('https://drive.google.com/file/d/abc…/view'); // → 'abc…'
```

**Events** bubble from the element: `dp:ready`, `dp:play`, `dp:pause`, `dp:ended`, `dp:open`, `dp:close`, `dp:fallback`, `dp:error`.

```js
document.addEventListener('dp:ended', e => console.log('Finished', e.target.driveId));
```

## 7. Using it in frameworks

`<drive-player>` is a standard Web Component, so it works in plain HTML, React, Vue, Svelte, Angular, WordPress (Custom HTML block), Webflow, Notion-style site builders, and others. Load `drive-player.js` once, then use the tag.

React example: `<drive-player src={link} title="Tour" mode="floating" dismiss-key="tour-v1" />`

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile). On iOS, full screen uses the native video player.
