import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Vitest does not enable Testing Library's automatic cleanup (no globals), so unmount here.
afterEach(() => cleanup());

// jsdom lacks the pointer APIs Radix menus use; Testing Library's user-event is happy with stubs.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// React reports invalid DOM nesting (li inside li, div inside p, ...) only as console.error, yet
// in the browser it breaks hydration and regenerates the tree. Turn it into a failure.
const nesting: string[] = [];
const originalError = console.error;
beforeEach(() => {
  nesting.length = 0;
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (/cannot be a descendant of|cannot contain a nested/.test(text)) nesting.push(text);
    originalError(...args);
  };
});
afterEach(() => {
  console.error = originalError;
  if (nesting.length) throw new Error(`Invalid DOM nesting:\n${nesting[0]!.slice(0, 400)}`);
});
