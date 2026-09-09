// Viewport-relative placement keeps menus out of clipped editors and scroll rails.
export function placePopover(anchor, size, viewport, margin = 8) {
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2))
  const maxHeight = Math.max(0, viewport.height - margin * 2)
  const height = Math.min(size.height, maxHeight)
  const left = Math.min(Math.max(margin, anchor.right - width), Math.max(margin, viewport.width - width - margin))
  const below = anchor.bottom + margin
  const above = anchor.top - height - margin
  const top = below + height <= viewport.height - margin ? below : Math.max(margin, above)
  return { left, top, width, maxHeight: Math.min(maxHeight, viewport.height - top - margin) }
}
