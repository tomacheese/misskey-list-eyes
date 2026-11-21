import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type NotifiedModule = typeof import('./notified')

let tempDir: string
let ledgerPath: string

/** Loads a fresh `Notified` bound to the per-test ledger path. */
async function loadNotified(): Promise<NotifiedModule['Notified']> {
  vi.resetModules()
  process.env.NOTIFIED_PATH = ledgerPath
  const module_ = await import('./notified')
  return module_.Notified
}

/** Builds the exact error message expected for an invalid ledger. */
function invalidLedgerMessage(reason: string): string {
  return `Invalid notified ledger at ${ledgerPath}: ${reason}. Repair the file, or delete it to start over (the next run then treats current notes as already notified and does not notify them).`
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notified-'))
  ledgerPath = path.join(tempDir, 'data', 'notified.json')
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.NOTIFIED_PATH
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('Notified', () => {
  it('creates the missing parent directory on the first write', async () => {
    const Notified = await loadNotified()
    expect(Notified.isFirst()).toBe(true)

    Notified.addNotified('a')

    expect(Notified.isFirst()).toBe(false)
    expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(
      JSON.stringify(['a'], null, 2)
    )
  })

  it('reports an unknown note as not notified without creating a file', async () => {
    const Notified = await loadNotified()

    expect(Notified.isNotified('a')).toBe(false)
    expect(fs.existsSync(ledgerPath)).toBe(false)
    expect(fs.existsSync(path.dirname(ledgerPath))).toBe(false)
  })

  it('remembers added notes in order', async () => {
    const Notified = await loadNotified()

    Notified.addNotified('a')
    Notified.addNotified('b')

    expect(Notified.isNotified('a')).toBe(true)
    expect(Notified.isNotified('b')).toBe(true)
    expect(Notified.isNotified('c')).toBe(false)
    expect(JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))).toEqual(['a', 'b'])
  })

  it('does not rewrite the ledger when the note is already recorded', async () => {
    const Notified = await loadNotified()
    const renameSpy = vi.spyOn(fs, 'renameSync')

    Notified.addNotified('a')
    Notified.addNotified('a')

    expect(renameSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))).toEqual(['a'])
  })

  describe('invalid ledger', () => {
    const cases: { name: string; content: string; reason: () => string }[] = [
      {
        name: 'an empty file',
        content: '',
        reason: () => 'file is empty'
      },
      {
        name: 'truncated JSON',
        content: '["a"',
        reason: () => {
          try {
            JSON.parse('["a"')
          } catch (error) {
            return `malformed JSON (${(error as Error).message})`
          }
          throw new Error('expected JSON.parse to throw')
        }
      },
      {
        name: 'a JSON object',
        content: '{"a":1}',
        reason: () => 'expected a JSON array of strings'
      },
      {
        name: 'an array with a non-string element',
        content: '["a",1]',
        reason: () => 'expected a JSON array of strings'
      }
    ]

    for (const { name, content, reason } of cases) {
      it(`rejects ${name} without modifying it`, async () => {
        fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
        fs.writeFileSync(ledgerPath, content)
        const Notified = await loadNotified()
        const expected = invalidLedgerMessage(reason())

        expect(() => Notified.isNotified('a')).toThrow(expected)
        expect(() => {
          Notified.addNotified('a')
        }).toThrow(expected)
        expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(content)
      })
    }
  })

  describe('interrupted write', () => {
    const original = JSON.stringify(['a'], null, 2)

    for (const method of ['writeSync', 'renameSync'] as const) {
      it(`keeps the previous ledger and closes the descriptor when ${method} fails`, async () => {
        fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
        fs.writeFileSync(ledgerPath, original)
        const Notified = await loadNotified()
        const closeSpy = vi.spyOn(fs, 'closeSync')
        vi.spyOn(fs, method).mockImplementation(() => {
          throw new Error(`${method} failed`)
        })

        expect(() => {
          Notified.addNotified('b')
        }).toThrow(`${method} failed`)

        expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(original)
        expect(closeSpy).toHaveBeenCalledTimes(1)
      })
    }
  })

  it('keeps the previous ledger when the write is short', async () => {
    const original = JSON.stringify(['a'], null, 2)
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
    fs.writeFileSync(ledgerPath, original)
    const Notified = await loadNotified()
    vi.spyOn(fs, 'writeSync').mockReturnValue(1)
    const renameSpy = vi.spyOn(fs, 'renameSync')

    expect(() => {
      Notified.addNotified('b')
    }).toThrow(
      `Short write to ${ledgerPath}.tmp: wrote 1 of ${Buffer.byteLength(JSON.stringify(['a', 'b'], null, 2))} bytes`
    )

    expect(renameSpy).not.toHaveBeenCalled()
    expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(original)
  })

  it('replaces a stale temporary file on the next write', async () => {
    const tmpPath = `${ledgerPath}.tmp`
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
    fs.writeFileSync(tmpPath, 'garbage that is not a ledger')
    const Notified = await loadNotified()

    expect(Notified.isNotified('a')).toBe(false)
    Notified.addNotified('a')

    expect(JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))).toEqual(['a'])
    expect(fs.existsSync(tmpPath)).toBe(false)
  })
})
