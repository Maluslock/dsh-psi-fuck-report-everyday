import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/patch-profile.mjs', import.meta.url))
const PLUGIN_ROOT = resolve(dirname(SCRIPT), '..')
const ID = 'dsh-psi-fuck-report-everyday'
const DEP = `link:${PLUGIN_ROOT}`

const tempDirs: string[] = []

function makeProfile(patch: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'eod-patch-profile-'))
  tempDirs.push(dir)
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: 'eod-patch-test-profile',
    private: true,
    dependencies: {},
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  return dir
}

function run(profile: string, action: 'add' | 'remove'): void {
  execFileSync(process.execPath, [SCRIPT, action, '--profile', profile], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: join(profile, '.isolated-dsh') },
  })
}

function readPatch(profile: string): string {
  return readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
}

function readDependencies(profile: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  return pkg.dependencies ?? {}
}

/**
 * Structural checker for the profile patch dialect: a top-level sequence of
 * block mappings whose nested block sequences use two-space indentation.
 * It rejects the exact failure this task fixes: a `[]` document marker
 * followed by sequence items.
 */
function parsePatchDocument(text: string): { empty: boolean; entries: number } {
  const body = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trimEnd())
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))

  if (body.length === 0) throw new Error('patch document has no YAML body')
  if (body.length === 1 && body[0]!.trim() === '[]') return { empty: true, entries: 0 }

  let entries = 0
  body.forEach((line, index) => {
    if (/^\s*\[\]\s*$/.test(line)) {
      throw new Error(`empty array marker mixed with sequence items at line ${index + 1}`)
    }
    const indent = line.length - line.trimStart().length
    if (indent % 2 !== 0) {
      throw new Error(`unexpected indentation at line ${index + 1}: ${line}`)
    }
    const content = line.trimStart()
    if (indent === 0) {
      if (!content.startsWith('- ')) {
        throw new Error(`top-level item must start with "- " at line ${index + 1}: ${line}`)
      }
      entries += 1
      return
    }
    if (!content.startsWith('- ') && !/^[A-Za-z0-9_.-]+:/.test(content)) {
      throw new Error(`invalid nested mapping at line ${index + 1}: ${line}`)
    }
  })
  return { empty: false, entries }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('patch-profile.mjs empty patch roots', () => {
  it('repairs a bare [] root, stays idempotent, and restores [] on remove', () => {
    const profile = makeProfile('[]\n')

    run(profile, 'add')
    const added = readPatch(profile)
    expect(parsePatchDocument(added)).toEqual({ empty: false, entries: 1 })
    expect(added).not.toMatch(/^\s*\[\]\s*$/m)
    expect(added).toContain(`- id: ${ID}`)
    expect(added.match(new RegExp(`- id: ${ID}`, 'g'))).toHaveLength(1)
    expect(readDependencies(profile)[ID]).toBe(DEP)

    run(profile, 'add')
    expect(readPatch(profile)).toBe(added)
    expect(readPatch(profile).match(new RegExp(`- id: ${ID}`, 'g'))).toHaveLength(1)

    run(profile, 'remove')
    expect(readPatch(profile)).toBe('[]\n')
    expect(parsePatchDocument(readPatch(profile))).toEqual({ empty: true, entries: 0 })
    expect(readDependencies(profile)).toEqual({})
  })

  it('handles a CRLF empty root', () => {
    const profile = makeProfile('[]\r\n')

    run(profile, 'add')
    expect(parsePatchDocument(readPatch(profile))).toEqual({ empty: false, entries: 1 })
    expect(readPatch(profile)).not.toMatch(/^\s*\[\]\s*$/m)

    run(profile, 'remove')
    expect(readPatch(profile)).toBe('[]\n')
  })

  it('keeps comments and an inline comment while dropping []', () => {
    const profile = makeProfile('# profile patch header\n[] # keep this note\n')

    run(profile, 'add')
    const added = readPatch(profile)
    expect(parsePatchDocument(added)).toEqual({ empty: false, entries: 1 })
    expect(added).toContain('# profile patch header')
    expect(added).toContain('# keep this note')
    expect(added).not.toMatch(/^\s*\[\]\s*(#.*)?$/m)
    expect(added).toContain(`- id: ${ID}`)

    run(profile, 'remove')
    expect(readPatch(profile)).toBe('[]\n')
    expect(readDependencies(profile)).toEqual({})
  })

  it('appends a sequence after a comments-only file and restores []', () => {
    const profile = makeProfile('# only comments\n# nothing else\n')

    run(profile, 'add')
    expect(parsePatchDocument(readPatch(profile))).toEqual({ empty: false, entries: 1 })
    expect(readPatch(profile)).toContain('# only comments')
    expect(readPatch(profile)).toContain(`- id: ${ID}`)

    run(profile, 'remove')
    expect(readPatch(profile)).toBe('[]\n')
    expect(readDependencies(profile)).toEqual({})
  })

  it('preserves existing entries and removes only the managed block', () => {
    const existing = '- id: other-plugin\n  disabled: true\n'
    const profile = makeProfile(existing)

    run(profile, 'add')
    const added = readPatch(profile)
    expect(parsePatchDocument(added)).toEqual({ empty: false, entries: 2 })
    expect(added.startsWith(existing)).toBe(true)
    expect(added).toContain(`- id: ${ID}`)
    expect(readDependencies(profile)[ID]).toBe(DEP)

    run(profile, 'remove')
    expect(readPatch(profile)).toBe(existing)
    expect(readDependencies(profile)).toEqual({})
  })
})
