# The grid

Every page in the office uses the same regions, container and type, so widths
and edges line up from page to page. The visual direction lives in the
[v2 design canvas](https://claude.ai/artifact/SiucTQH9mrPfT3FK1zSztA) (board 4).

## Regions (desktop, ≥ 1024 px)

| Region                              | Width                   | Behavior                                                                                      |
| ----------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| Sidebar                             | 248 px, or a 68 px rail | Collapses with the panel button; the choice is remembered per browser. ⌘K focuses its search. |
| Content                             | fluid                   | Scrolls on its own; the window never scrolls.                                                 |
| Side panel (room, delivery details) | 360 px                  | Fixed; scrolls on its own.                                                                    |

Below 1024 px the regions stack and the page scrolls normally.

## Container

Use `.page` for the content of every page (`apps/web/src/app/globals.css`):

- max width 1200 px, centered;
- padding 20 px on phones, 32 px from 640 px;
- 24 px between blocks.

Forms that read better narrow go inside `.page-narrow` (760 px), which keeps
them aligned to the container's left edge.

## Header

```tsx
<header className="page-header">
  <div className="page-heading">
    <span className="page-eyebrow">Marketing</span> {/* optional */}
    <h1 className="page-title">Content & SEO</h1>
    <p className="page-intro">One or two sentences.</p>
  </div>
  {/* actions on the right */}
</header>
```

Titles are 26 px Space Grotesk; body text 14–15 px Inter; spacing steps 4, 8,
12, 16, 24, 32, 48.

## Page templates

| Template  | Pages                                                                | Layout                   |
| --------- | -------------------------------------------------------------------- | ------------------------ |
| Workspace | team                                                                 | content + room           |
| Document  | delivery                                                             | content + details panel  |
| Hub       | home, waiting, hire, models, integrations, audit, agent, new request | content only             |
| Focused   | (team builder, Phase 8)                                              | no sidebar, steps on top |
