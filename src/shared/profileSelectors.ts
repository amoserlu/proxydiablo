/** Origin-qualified selectors remain stable when environments are reordered. */
export function environmentName(selector: string): string | undefined {
  if (selector.startsWith('env:')) return selector.slice(4);
  if (selector.startsWith('pgadmin:')) return undefined;
  return selector;
}
