#!/usr/bin/env node
/**
 * Link this plugin into a DSH profile and mount it through the profile patch.
 *
 * Usage:
 *   node scripts/patch-profile.mjs add    [--profile <dir>]
 *   node scripts/patch-profile.mjs remove [--profile <dir>]
 *
 * Default profile: ${DSH_HOME:-$HOME/.dsh}/profiles/web
 * `add` writes dependencies["dsh-psi-fuck-report-everyday"] = "link:<plugin root>"
 * and appends one insert block to the profile's cordis.patch.yml.
 * `remove` reverses both edits and leaves every other entry untouched.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ID = 'dsh-psi-fuck-report-everyday'
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DEP = `link:${ROOT}`
const BLOCK = ['- insert:', `    - id: ${ID}`, `      name: ${ID}`].join('\n')

function fail(message) {
  console.error(`[patch-profile] ${message}`)
  process.exit(1)
}

function usage() {
  const lines = [
    'Usage: node scripts/patch-profile.mjs <add|remove> [--profile <dir>]',
    `Default profile: ${defaultProfileDir()}`,
  ]
  console.log(lines.join('\n'))
}

function defaultProfileDir() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'profiles', 'web')
}

function parseArgs(argv) {
  const [action, ...rest] = argv
  if (action !== 'add' && action !== 'remove') usage(), process.exit(action ? 1 : 0)
  let profile = process.env.DSH_PROFILE_DIR || defaultProfileDir()
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === '--profile') {
      const value = rest[i + 1]
      if (!value) fail('--profile 需要目录参数')
      profile = value
      i += 1
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
    } else {
      fail(`未知参数：${arg}`)
    }
  }
  return { action, profile: resolve(profile) }
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

function editPackageJson(profileDir, action) {
  const path = join(profileDir, 'package.json')
  if (!existsSync(path)) fail(`找不到 profile manifest：${path}`)
  let pkg
  try {
    pkg = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`无法解析 ${path}：${error instanceof Error ? error.message : String(error)}`)
  }
  if (action === 'add') {
    pkg.dependencies = pkg.dependencies || {}
    const previous = pkg.dependencies[ID]
    pkg.dependencies[ID] = DEP
    writeAtomic(path, `${JSON.stringify(pkg, null, 2)}\n`)
    console.log(`[patch-profile] dependency ${ID} -> ${DEP}${previous ? ` (替换 ${previous})` : ''}`)
    return
  }
  if (pkg.dependencies && ID in pkg.dependencies) {
    delete pkg.dependencies[ID]
    writeAtomic(path, `${JSON.stringify(pkg, null, 2)}\n`)
    console.log(`[patch-profile] 已从 dependencies 移除 ${ID}`)
    return
  }
  console.log(`[patch-profile] dependencies 中没有 ${ID}，跳过`)
}

function editCordisPatch(profileDir, action) {
  const path = join(profileDir, 'cordis.patch.yml')
  const exists = existsSync(path)
  if (!exists && action === 'remove') {
    console.log('[patch-profile] profile 没有 cordis.patch.yml，跳过挂载项')
    return
  }
  const text = exists ? readFileSync(path, 'utf8') : ''
  const idPattern = new RegExp(`^\\s*- id: ${ID}\\s*$`, 'm')

  if (action === 'add') {
    if (idPattern.test(text)) {
      console.log(`[patch-profile] cordis.patch.yml 已含 ${ID} 行，跳过挂载项`)
      return
    }
    const base = text.replace(/\s+$/, '')
    const next = `${base ? `${base}\n\n` : ''}${BLOCK}\n`
    writeAtomic(path, next)
    console.log(`[patch-profile] cordis.patch.yml 已追加 ${ID} 挂载项`)
    return
  }

  if (!text.includes(BLOCK)) {
    if (idPattern.test(text)) {
      console.log(`[patch-profile] cordis.patch.yml 中的 ${ID} 行不是本脚本管理的块，保持原样`)
    } else {
      console.log('[patch-profile] cordis.patch.yml 没有本脚本管理的挂载块，跳过')
    }
    return
  }
  const next = text
    .replace(`${BLOCK}\n`, '')
    .replace(`${BLOCK}`, '')
    .replace(/\n{3,}$/, '\n')
    .replace(/^\n+/, '')
  writeAtomic(path, next)
  console.log(`[patch-profile] cordis.patch.yml 已移除 ${ID} 挂载项`)
}

function main() {
  const { action, profile } = parseArgs(process.argv.slice(2))
  if (!existsSync(profile)) fail(`profile 目录不存在：${profile}`)
  editPackageJson(profile, action)
  editCordisPatch(profile, action)
  console.log(`[patch-profile] ${action} 完成：${profile}`)
}

main()
