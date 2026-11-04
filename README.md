# Docker Compose Studio

Edit Docker Compose files visually in VS Code. Follow connections between resources, edit their properties in the sidebar, and switch to YAML whenever you need to work directly in the file.

Built by **kadadana**.

## Get started

Requires VS Code **1.96 or later**. Docker is optional for editing Compose files.

1. Open a folder with a Compose file and select **Docker Compose Studio** in the Activity Bar.
2. Choose a file under **Compose Files**. You can also right-click a Compose YAML file and select **Dokur: Open Visual Editor**.
3. Select a resource on the graph or in the sidebar, then edit it in **Properties**.

Use **Dokur: New Compose File** to start from scratch or **Dokur: Create Example Stack** to explore the editor. For a local VSIX, use **Extensions → … → Install from VSIX…**.

## Work with the graph

- Explore services, networks, volumes, secrets, configs, models, and jobs. Each resource type has its own fabric and cord, and selection highlights outgoing connections.
- Drag from either side of a service or job to a compatible resource. Drop a connection on the canvas to create and connect a new resource in a single undoable edit.
- Select a connection to bend it or disconnect it. Double-click its bend handle to reset the curve, or use the arrow keys while the handle has focus.
- Use **Arrange nodes** to reset the layout and custom bends. **Fit to view** brings the graph into view. Dokur stores positions and bends in VS Code's editor state.

## Edit properties and YAML

The native **Properties** tree expands nested objects and lists. Select a value to edit it, or use **Add property…** to see fields available at that location in the Compose schema. Renaming a **Resource key** updates supported local references. Selecting the blank canvas opens project properties.

**YAML Source** opens the underlying file in VS Code's text editor. The graph follows source edits, and visual edits use VS Code's save and undo history. **Format YAML** converts populated maps and lists to block style while preserving comments and anchors. Open **Problems** for syntax, schema, and supported reference diagnostics.

## Find container images

Select **Docker Hub** in the sidebar, the **image** property, or **Search Docker Hub** when creating a resource. Type a search term and press **Enter**, then choose a public image and tag. Use **Enter image manually…** to enter a custom registry, local image, digest, or another tag.

## Scope and privacy

Dokur edits Compose files. Starting containers and managing the Docker daemon are outside its scope. It preserves bind mounts and anonymous volumes in YAML, and draws connections for supported named resources. The graph does not merge external files from `include` or `extends`, or expand environment variables.

Validation runs locally against the bundled Compose schema. Docker Hub requests send the search term or the selected repository name. Dokur does not send your Compose file or environment variables to Docker Hub and does not collect telemetry.

## Development

Use Node.js 22 or later.

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:ui
npm run test:vscode
npm run package
```

Press **F5** to launch the Extension Development Host. Run `npm run preview` after building to preview the graph in a browser. Use `npm run schema:update` to refresh the bundled Compose schema, or `npm run materials:prepare` to regenerate the WebP textures from the original artwork.

Dokur is licensed under MIT. The VSIX includes notices for its bundled dependencies, the Apache-2.0 Compose schema, and the SIL Open Font License for Inter.
