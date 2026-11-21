import fs from 'node:fs'
import path from 'node:path'

const NOTIFIED_PATH = process.env.NOTIFIED_PATH ?? 'data/notified.json'

/**
 * Builds the error thrown for an unusable ledger.
 *
 * @param reason - Why the ledger is invalid, embedded in the message
 * @param cause - The underlying error, if any
 * @returns An error naming the ledger path and how the operator can recover
 */
function invalidLedger(reason: string, cause?: unknown): Error {
  return new Error(
    `Invalid notified ledger at ${NOTIFIED_PATH}: ${reason}. Repair the file, or delete it to start over (the next run then treats current notes as already notified and does not notify them).`,
    { cause }
  )
}

/**
 * Reads the ledger of notified note IDs.
 *
 * @returns The recorded IDs, or an empty array when the file does not exist
 * @throws If the file is not a JSON array of strings. The file is never repaired automatically.
 */
function readLedger(): string[] {
  if (!fs.existsSync(NOTIFIED_PATH)) {
    return []
  }
  const content = fs.readFileSync(NOTIFIED_PATH, 'utf8')
  if (content === '') {
    throw invalidLedger('file is empty')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw invalidLedger(`malformed JSON (${(error as Error).message})`, error)
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((id): id is string => typeof id === 'string')
  ) {
    throw invalidLedger('expected a JSON array of strings')
  }
  return parsed
}

/**
 * Writes the ledger so that `NOTIFIED_PATH` is never left partially written:
 * the content goes to a sibling temporary file that is renamed over the ledger.
 */
function writeLedger(ids: string[]): void {
  fs.mkdirSync(path.dirname(NOTIFIED_PATH), { recursive: true })
  const temporaryPath = `${NOTIFIED_PATH}.tmp`
  const fd = fs.openSync(temporaryPath, 'w')
  try {
    const data = Buffer.from(JSON.stringify(ids, null, 2))
    const written = fs.writeSync(fd, data)
    if (written !== data.length) {
      throw new Error(
        `Short write to ${temporaryPath}: wrote ${written} of ${data.length} bytes`
      )
    }
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(temporaryPath, NOTIFIED_PATH)
}

export class Notified {
  public static isFirst(): boolean {
    return !fs.existsSync(NOTIFIED_PATH)
  }

  public static isNotified(tweetId: string): boolean {
    return readLedger().includes(tweetId)
  }

  public static addNotified(tweetId: string): void {
    const ids = readLedger()
    if (ids.includes(tweetId)) {
      return
    }
    writeLedger([...ids, tweetId])
  }
}
