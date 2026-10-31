export interface TagPickerOption {
  id: string
  name: string
}

export type TagPickerEnterAction
  = | { kind: 'toggle', id: string }
    | { kind: 'create', name: string }
    | null

export function filterTagOptions<T extends TagPickerOption>(tags: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase()
  return needle ? tags.filter(tag => tag.name.toLocaleLowerCase().includes(needle)) : [...tags]
}

// What Enter should do when no row is highlighted: toggle the only matching tag, or create the typed
// tag when nothing matches. Anything else needs an explicit choice from the list.
export function tagPickerEnterAction(tags: readonly TagPickerOption[], query: string): TagPickerEnterAction {
  const name = query.trim()
  if (!name)
    return null
  const matches = filterTagOptions(tags, name)
  if (matches.length === 1)
    return { kind: 'toggle', id: matches[0]!.id }
  return matches.length === 0 ? { kind: 'create', name } : null
}
