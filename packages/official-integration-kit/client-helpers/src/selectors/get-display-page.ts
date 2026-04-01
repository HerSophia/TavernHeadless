import { getActivePage } from "./get-active-page.js";

export function getDisplayPage<TPage, TPending>(input: {
  activePage?: TPage | null;
  pages?: TPage[] | null;
  pendingOutput?: TPending | null;
}): TPage | TPending | null {
  if (input.pendingOutput) {
    return input.pendingOutput;
  }

  return getActivePage({
    activePage: input.activePage,
    pages: input.pages,
  });
}
