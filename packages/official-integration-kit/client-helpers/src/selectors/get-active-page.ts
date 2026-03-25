export function getActivePage<TPage>(input: {
  activePage?: TPage | null;
  pages?: TPage[] | null;
}): TPage | null {
  if (input.activePage) {
    return input.activePage;
  }

  const pages = input.pages ?? [];
  return pages.length > 0 ? pages[0] ?? null : null;
}
