import fs from 'node:fs'

const NOTIFIED_PATH = process.env.NOTIFIED_PATH ?? 'data/notified.json'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class Notified {
  public static isFirst(): boolean {
    return !fs.existsSync(NOTIFIED_PATH)
  }

  public static isNotified(tweetId: string): boolean {
    const json: string[] = fs.existsSync(NOTIFIED_PATH)
      ? JSON.parse(fs.readFileSync(NOTIFIED_PATH, 'utf8'))
      : []
    return json.includes(tweetId)
  }

  public static addNotified(tweetId: string): void {
    const json: string[] = fs.existsSync(NOTIFIED_PATH)
      ? JSON.parse(fs.readFileSync(NOTIFIED_PATH, 'utf8'))
      : []
    json.push(tweetId)
    fs.writeFileSync(NOTIFIED_PATH, JSON.stringify(json, null, 2))
  }
}
