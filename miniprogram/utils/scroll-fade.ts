export const getScrollFadeState = (
  scrollLeft: number,
  scrollWidth: number,
  viewportWidth: number,
) => {
  const hasOverflow = scrollWidth > viewportWidth + 4
  const nearStart = scrollLeft <= 16
  const nearEnd = scrollLeft + viewportWidth >= scrollWidth - 16

  return {
    showLeft: hasOverflow && !nearStart,
    showRight: hasOverflow && !nearEnd,
  }
}
