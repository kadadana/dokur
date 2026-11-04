# Changelog

## 0.5.11

- Added the GitHub repository link to the extension metadata and a graph screenshot to the repository README.

## 0.5.10

- Set the extension display name to **Dokur - Docker Compose Studio** across VS Code and Marketplace.

## 0.5.9

- Updated the Marketplace logo and Activity Bar icon to match the editor's weave symbol.

## 0.5.8

- Renamed the extension display name to **Docker Compose Studio** in Marketplace and VS Code.

## 0.5.7

- Prepared the first Marketplace package under the `kadadana.dokur` extension ID.
- Added English documentation, Marketplace metadata, and notices for bundled libraries.

## 0.5.6

- Replaced the raster canvas backdrop with a subtle SVG linen weave.

## 0.5.5

- Simplified the canvas backdrop to a single linen surface.

## 0.5.4

- Added a photographic wooden loom backdrop with theme-specific opacity.

## 0.5.3

- Added a minimal loom illustration behind the graph.

## 0.5.2

- Improved dragging and bending by previewing connections as SVG curves while they move and restoring the cord textures after release.
- Paused decorative shadows during canvas movement and saved bends when the gesture ended.

## 0.5.1

- Added a weaving icon for the visual editor command and Architecture menu, with light and dark versions.

## 0.5.0

- Added distinct fabric and cord textures for all seven resource types.
- Shaped selection highlights, hit areas, and connection ports around the frayed edges of each card.
- Bundled optimized WebP materials for offline use.

## 0.4.2

- Switched to low-contrast linen cards and photographic cotton cord.
- Mapped cord textures along curves so they follow custom bends.

## 0.4.1

- Added fabric cards, stitched dividers, and textured connections.
- Fixed a stale update that could briefly bring back a resource after undo.

## 0.4.0

- Moved Docker Hub search to VS Code Quick Pick with explicit search submission, tag selection, and manual entry.
- Shared the image picker between resource creation and the Properties tree.
- Prevented cancelled or stale searches from editing the document.

## 0.3.4

- Bundled Inter for graph labels, card details, and dialogs.

## 0.3.3

- Enabled connections from either side of services and jobs.
- Highlighted outgoing edges on selection and restored project properties when the canvas was cleared.

## 0.3.2

- Improved graph typography, card spacing, and access to bend handles.

## 0.3.1

- Renamed the Properties entry to **Resource key** to distinguish it from the Compose `name` field.

## 0.3.0

- Added editable Bézier connections with persistent bends.
- Added resource creation by dropping a connection on the canvas.
- Moved property editing to a native VS Code tree with nested objects and arrays.

## 0.2.1

- Added undoable block YAML formatting that preserves comments and anchors.
- Made the image picker available for services and jobs without an existing image.

## 0.2.0

- Added native VS Code navigation, a resource tree, and a separate Properties view.
- Integrated editor themes, YAML source navigation, and the Problems panel.

## 0.1.0

- Introduced schema-based Compose editing, a visual resource graph, and Docker Hub search.
- Added local reference validation, comment-preserving edits, and VS Code save and undo support.
