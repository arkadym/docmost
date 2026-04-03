<div align="center">
    <h1><b>Docmost</b></h1>
    <p>
        Open-source collaborative wiki and documentation software.
        <br />
        <a href="https://docmost.com"><strong>Website</strong></a> | 
        <a href="https://docmost.com/docs"><strong>Documentation</strong></a> |
        <a href="https://twitter.com/DocmostHQ"><strong>Twitter / X</strong></a>
    </p>
</div>
<br />

---

## About this fork

This is a personal fork of [Docmost](https://github.com/docmost/docmost), maintained by [@arkadym](https://github.com/arkadym) for my own self-hosted instance and day-to-day use.

**A few honest disclaimers:**

- I built these features for my own needs and currently have no time to maintain them as a proper open-source contribution.
- I'm not a React developer, and I'm not deeply familiar with Docmost's internals — so I lean heavily on AI-assisted development (GitHub Copilot) to implement things.
- Because of that — and the time constraints — I don't plan to submit pull requests or engage in upstream review cycles. The code works for me; use it at your own risk.

If something here is useful to you, feel free to cherry-pick or fork.

---

## Features added in this fork

### PlantUML diagrams
- New `PlantUML` block type in the editor.
- Split-view editor modal: code on the left, rendered preview on the right with debounced auto-render.
- Wheel zoom, pan, and Reset Center in the preview pane.
- Markdown export/import round-trip (code preserved as fenced block with metadata).

### XMind import
- Drag-and-drop `.xmind` files directly into the editor — converts the mindmap to a PlantUML `@startmindmap` diagram.
- Full color mapping from XMind topic styles.
- Toolbar: re-import from updated file, download original `.xmind`.

### Lightbox for diagrams and images
- Click any image, PlantUML, or DrawIO/Excalidraw diagram in read mode to open a full-screen lightbox with zoom and pan.

### Logo badge overlay
- DrawIO and Excalidraw diagram images display a small logo badge so you can tell them apart at a glance.

### Page properties
- A structured properties panel (outside the editor) backed by a Yjs `Y.Map` — survives real-time collaboration.
- Properties are exported as YAML frontmatter in Markdown export and re-imported on Markdown/Joplin import.

### Import improvements
- **Overwrite mode** — re-importing a ZIP/Markdown file can update existing pages instead of always creating duplicates.
- **Skip unchanged** — pages whose content hasn't changed are silently skipped.
- **Import summary** — a report is shown after import listing created, updated, skipped, and failed pages.
- **Joplin markdown** — improved handling of Joplin export format (front-matter dates, title headers, external links).
- **OneNote / Joplin HTML** — strips redundant title `<div>`, extracts creation date, adds source-URL button.

### Page sorting
- Choose sort order per space or per folder (title A–Z, created date, updated date, manual).
- Sort overrides are stored per-node, so different folders can have different orderings.
- Pages re-sort live without a page reload.

### Persistent aside panel
- The sidebar/aside panel remembers its open/closed state and active section across navigation.

---

## Getting started

To get started with Docmost, please refer to our [documentation](https://docmost.com/docs) or try our [cloud version](https://docmost.com/pricing) .

## Features

- Real-time collaboration
- Diagrams (Draw.io, Excalidraw and Mermaid)
- Spaces
- Permissions management
- Groups
- Comments
- Page history
- Search
- File attachments
- Embeds (Airtable, Loom, Miro and more)
- Translations (10+ languages)

### Screenshots

<p align="center">
<img alt="home" src="https://docmost.com/screenshots/home.png" width="70%">
<img alt="editor" src="https://docmost.com/screenshots/editor.png" width="70%">
</p>

### License
Docmost core is licensed under the open-source AGPL 3.0 license.  
Enterprise features are available under an enterprise license (Enterprise Edition).  

All files in the following directories are licensed under the Docmost Enterprise license defined in `packages/ee/License`.
  - apps/server/src/ee
  - apps/client/src/ee
  - packages/ee

### Contributing

See the [development documentation](https://docmost.com/docs/self-hosting/development)

## Thanks
Special thanks to;

<img width="100" alt="Crowdin" src="https://github.com/user-attachments/assets/a6c3d352-e41b-448d-b6cd-3fbca3109f07" />

[Crowdin](https://crowdin.com/) for providing access to their localization platform.


<img width="48" alt="Algolia-mark-square-white" src="https://github.com/user-attachments/assets/6ccad04a-9589-4965-b6a1-d5cb1f4f9e94" />

[Algolia](https://www.algolia.com/) for providing full-text search to the docs.

