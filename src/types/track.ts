export interface Track {
  id: string
  file: File
  name: string
  duration: number | null
}

export function trackFromFile(file: File): Track {
  const name = file.name.replace(/\.[^/.]+$/, '')
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    name,
    duration: null,
  }
}
